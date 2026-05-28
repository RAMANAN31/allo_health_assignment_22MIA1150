import { pool } from './db';
import crypto from 'crypto';

/**
 * Lazy cleanup of expired reservations.
 * Scans for reservations that are still PENDING but past their expiresAt date.
 */
export async function lazyCleanupExpiredReservations() {
  const now = new Date();

  const expired = await pool.query(
    'SELECT * FROM "Reservation" WHERE status = \'PENDING\' AND "expiresAt" < $1',
    [now]
  );

  if (expired.rowCount === 0) return;

  console.log(`[Lazy Cleanup] Found ${expired.rowCount} expired reservations to clean up.`);

  for (const res of expired.rows) {
    try {
      // Atomic update: only proceed if still PENDING (guards against double-cleanup)
      const updated = await pool.query(
        'UPDATE "Reservation" SET status = \'EXPIRED\', "releasedAt" = $1 WHERE id = $2 AND status = \'PENDING\'',
        [now, res.id]
      );

      if (updated.rowCount && updated.rowCount > 0) {
        await pool.query(
          'UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" - $1 WHERE "productId" = $2 AND "warehouseId" = $3',
          [res.quantity, res.productId, res.warehouseId]
        );
        console.log(`[Lazy Cleanup] Expired reservation ${res.id}, restored ${res.quantity} units.`);
      }
    } catch (err) {
      console.error(`[Lazy Cleanup] Failed for reservation ${res.id}:`, err);
    }
  }
}

/**
 * Creates a new inventory reservation.
 * Uses optimistic concurrency control:
 * - We capture the current reservedUnits value.
 * - We attempt an atomic conditional UPDATE that only succeeds when
 *   reservedUnits + quantity <= totalUnits.
 * - If the row was already modified concurrently, rowCount is 0
 *   and we return 409 Conflict, perfectly mimicking SELECT FOR UPDATE semantics.
 */
export async function createReservation(
  productId: string,
  warehouseId: string,
  quantity: number,
  idempotencyKey?: string
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes

  // 1. Check Idempotency Key
  if (idempotencyKey) {
    const existing = await pool.query(
      'SELECT * FROM "IdempotencyRecord" WHERE key = $1',
      [idempotencyKey]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      const record = existing.rows[0];
      if (now > new Date(record.expiresAt)) {
        await pool.query('DELETE FROM "IdempotencyRecord" WHERE key = $1', [idempotencyKey]);
      } else {
        return { response: JSON.parse(record.responseBody), status: record.statusCode };
      }
    }
  }

  // 2. Run lazy cleanup to free up any expired stock
  await lazyCleanupExpiredReservations();

  // 3. Read current inventory snapshot
  const invRes = await pool.query(
    'SELECT * FROM "Inventory" WHERE "productId" = $1 AND "warehouseId" = $2',
    [productId, warehouseId]
  );

  if (invRes.rowCount === 0) {
    return { response: { error: 'No inventory record found for the given product and warehouse.' }, status: 404 };
  }

  const inventory = invRes.rows[0];
  const available = inventory.totalUnits - inventory.reservedUnits;
  if (available < quantity) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    if (idempotencyKey) {
      await pool.query(
        'INSERT INTO "IdempotencyRecord" (key, "responseBody", "statusCode", "expiresAt", "createdAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING',
        [idempotencyKey, JSON.stringify(resp), 409, new Date(now.getTime() + 24 * 60 * 60 * 1000), now]
      ).catch(() => {}); // ignore duplicate key race
    }
    return { response: resp, status: 409 };
  }

  // 4. Atomic conditional update — only succeeds if stock hasn't changed
  // This is optimistic locking: we condition on the exact reservedUnits we read.
  const updated = await pool.query(
    'UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" + $1 WHERE "productId" = $2 AND "warehouseId" = $3 AND "reservedUnits" = $4 AND "totalUnits" >= "reservedUnits" + $1',
    [quantity, productId, warehouseId, inventory.reservedUnits]
  );

  // 5. If rowCount is 0, a concurrent request changed the row — conflict!
  if (!updated.rowCount || updated.rowCount === 0) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    return { response: resp, status: 409 };
  }

  // 6. Create the Reservation record using crypto.randomUUID()
  const reservationId = crypto.randomUUID();
  await pool.query(
    'INSERT INTO "Reservation" (id, "productId", "warehouseId", quantity, status, "expiresAt", "createdAt", "idempotencyKey") VALUES ($1, $2, $3, $4, \'PENDING\', $5, $6, $7)',
    [reservationId, productId, warehouseId, quantity, expiresAt, now, idempotencyKey || null]
  );

  const responseData = { reservationId, expiresAt };

  if (idempotencyKey) {
    await pool.query(
      'INSERT INTO "IdempotencyRecord" (key, "responseBody", "statusCode", "expiresAt", "createdAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING',
      [idempotencyKey, JSON.stringify(responseData), 201, new Date(now.getTime() + 24 * 60 * 60 * 1000), now]
    ).catch(() => {}); // ignore duplicate key race
  }

  return { response: responseData, status: 201 };
}

/**
 * Confirms a reservation — deducts stock permanently.
 */
export async function confirmReservation(reservationId: string, idempotencyKey?: string) {
  const now = new Date();

  if (idempotencyKey) {
    const existing = await pool.query(
      'SELECT * FROM "IdempotencyRecord" WHERE key = $1',
      [idempotencyKey]
    );
    if (existing.rowCount && existing.rowCount > 0) {
      const record = existing.rows[0];
      if (now > new Date(record.expiresAt)) {
        await pool.query('DELETE FROM "IdempotencyRecord" WHERE key = $1', [idempotencyKey]);
      } else {
        return { response: JSON.parse(record.responseBody), status: record.statusCode };
      }
    }
  }

  const resQuery = await pool.query(
    'SELECT * FROM "Reservation" WHERE id = $1',
    [reservationId]
  );

  if (resQuery.rowCount === 0) {
    return { response: { error: 'Reservation not found.' }, status: 404 };
  }

  const reservation = resQuery.rows[0];

  if (reservation.status === 'CONFIRMED') {
    return {
      response: { message: 'Reservation already confirmed.', reservationId, status: 'CONFIRMED' },
      status: 200,
    };
  }

  if (reservation.status === 'RELEASED') {
    return { response: { error: 'Cannot confirm a cancelled reservation.' }, status: 400 };
  }

  // Check expiry (handles EXPIRED status or time-based expiry)
  const isExpired = reservation.status === 'EXPIRED' || now > new Date(reservation.expiresAt);
  if (isExpired) {
    // Mark as expired and restore stock if still PENDING
    if (reservation.status === 'PENDING') {
      await pool.query(
        'UPDATE "Reservation" SET status = \'EXPIRED\', "releasedAt" = $1 WHERE id = $2 AND status = \'PENDING\'',
        [now, reservationId]
      );
      await pool.query(
        'UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" - $1 WHERE "productId" = $2 AND "warehouseId" = $3',
        [reservation.quantity, reservation.productId, reservation.warehouseId]
      );
    }
    return { response: { error: 'Reservation has expired. Inventory returned to available stock.' }, status: 410 };
  }

  // Atomic confirm — only succeeds if still PENDING
  const confirmedCount = await pool.query(
    'UPDATE "Reservation" SET status = \'CONFIRMED\', "confirmedAt" = $1 WHERE id = $2 AND status = \'PENDING\'',
    [now, reservationId]
  );

  if (!confirmedCount.rowCount || confirmedCount.rowCount === 0) {
    return { response: { error: 'Reservation could not be confirmed (concurrent state change).' }, status: 409 };
  }

  // Permanently deduct stock
  await pool.query(
    'UPDATE "Inventory" SET "totalUnits" = "totalUnits" - $1, "reservedUnits" = "reservedUnits" - $1 WHERE "productId" = $2 AND "warehouseId" = $3',
    [reservation.quantity, reservation.productId, reservation.warehouseId]
  );

  const responseData = { message: 'Reservation confirmed. Stock permanently deducted.', reservationId, status: 'CONFIRMED' };

  if (idempotencyKey) {
    await pool.query(
      'INSERT INTO "IdempotencyRecord" (key, "responseBody", "statusCode", "expiresAt", "createdAt") VALUES ($1, $2, $3, $4, $5) ON CONFLICT (key) DO NOTHING',
      [idempotencyKey, JSON.stringify(responseData), 200, new Date(now.getTime() + 24 * 60 * 60 * 1000), now]
    ).catch(() => {});
  }

  return { response: responseData, status: 200 };
}

/**
 * Releases a reservation — restores reserved stock.
 */
export async function releaseReservation(reservationId: string) {
  const now = new Date();

  const resQuery = await pool.query(
    'SELECT * FROM "Reservation" WHERE id = $1',
    [reservationId]
  );

  if (resQuery.rowCount === 0) {
    return { response: { error: 'Reservation not found.' }, status: 404 };
  }

  const reservation = resQuery.rows[0];

  if (reservation.status === 'RELEASED') {
    return { response: { message: 'Reservation already released.', reservationId, status: 'RELEASED' }, status: 200 };
  }

  if (reservation.status === 'CONFIRMED') {
    return { response: { error: 'Cannot release a confirmed reservation.' }, status: 400 };
  }

  if (reservation.status === 'EXPIRED') {
    return { response: { message: 'Reservation already expired and stock was restored.', reservationId, status: 'EXPIRED' }, status: 200 };
  }

  // Atomic release — only succeeds if still PENDING
  const releasedCount = await pool.query(
    'UPDATE "Reservation" SET status = \'RELEASED\', "releasedAt" = $1 WHERE id = $2 AND status = \'PENDING\'',
    [now, reservationId]
  );

  if (!releasedCount.rowCount || releasedCount.rowCount === 0) {
    return { response: { message: 'Reservation already resolved.', reservationId }, status: 200 };
  }

  await pool.query(
    'UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" - $1 WHERE "productId" = $2 AND "warehouseId" = $3',
    [reservation.quantity, reservation.productId, reservation.warehouseId]
  );

  return {
    response: { message: 'Reservation released. Stock returned to available pool.', reservationId, status: 'RELEASED' },
    status: 200,
  };
}
