import { sql } from './db';
import crypto from 'crypto';

/**
 * Lazy cleanup of expired reservations.
 * Scans for reservations that are still PENDING but past their expiresAt date.
 */
export async function lazyCleanupExpiredReservations() {
  const now = new Date();

  const expired = await sql`
    SELECT * FROM "Reservation" WHERE status = 'PENDING' AND "expiresAt" < ${now}
  `;

  if (expired.length === 0) return;

  console.log(`[Lazy Cleanup] Found ${expired.length} expired reservations to clean up.`);

  for (const res of expired) {
    try {
      // Atomic update: only proceed if still PENDING (guards against double-cleanup)
      const updated = await sql`
        UPDATE "Reservation" SET status = 'EXPIRED', "releasedAt" = ${now}
        WHERE id = ${res.id} AND status = 'PENDING'
        RETURNING id
      `;

      if (updated.length > 0) {
        await sql`
          UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" - ${res.quantity}
          WHERE "productId" = ${res.productId} AND "warehouseId" = ${res.warehouseId}
        `;
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
 * - If the row was already modified concurrently, the update returns 0 rows
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
    const existing = await sql`
      SELECT * FROM "IdempotencyRecord" WHERE key = ${idempotencyKey}
    `;
    if (existing.length > 0) {
      const record = existing[0];
      if (now > new Date(record.expiresAt)) {
        await sql`DELETE FROM "IdempotencyRecord" WHERE key = ${idempotencyKey}`;
      } else {
        return { response: JSON.parse(record.responseBody), status: record.statusCode };
      }
    }
  }

  // 2. Run lazy cleanup to free up any expired stock
  await lazyCleanupExpiredReservations();

  // 3. Read current inventory snapshot
  const invRes = await sql`
    SELECT * FROM "Inventory" WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
  `;

  if (invRes.length === 0) {
    return { response: { error: 'No inventory record found for the given product and warehouse.' }, status: 404 };
  }

  const inventory = invRes[0];
  const available = inventory.totalUnits - inventory.reservedUnits;
  if (available < quantity) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    if (idempotencyKey) {
      try {
        await sql`
          INSERT INTO "IdempotencyRecord" (key, "responseBody", "statusCode", "expiresAt", "createdAt")
          VALUES (${idempotencyKey}, ${JSON.stringify(resp)}, ${409}, ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}, ${now})
          ON CONFLICT (key) DO NOTHING
        `;
      } catch { /* ignore duplicate key race */ }
    }
    return { response: resp, status: 409 };
  }

  // 4. Atomic conditional update — only succeeds if stock hasn't changed
  // This is optimistic locking: we condition on the exact reservedUnits we read.
  const updated = await sql`
    UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" + ${quantity}
    WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
      AND "reservedUnits" = ${inventory.reservedUnits}
      AND "totalUnits" >= "reservedUnits" + ${quantity}
    RETURNING id
  `;

  // 5. If 0 rows returned, a concurrent request changed the row — conflict!
  if (updated.length === 0) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    return { response: resp, status: 409 };
  }

  // 6. Create the Reservation record using crypto.randomUUID()
  const reservationId = crypto.randomUUID();
  await sql`
    INSERT INTO "Reservation" (id, "productId", "warehouseId", quantity, status, "expiresAt", "createdAt", "idempotencyKey")
    VALUES (${reservationId}, ${productId}, ${warehouseId}, ${quantity}, 'PENDING', ${expiresAt}, ${now}, ${idempotencyKey || null})
  `;

  const responseData = { reservationId, expiresAt };

  if (idempotencyKey) {
    try {
      await sql`
        INSERT INTO "IdempotencyRecord" (key, "responseBody", "statusCode", "expiresAt", "createdAt")
        VALUES (${idempotencyKey}, ${JSON.stringify(responseData)}, ${201}, ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}, ${now})
        ON CONFLICT (key) DO NOTHING
      `;
    } catch { /* ignore duplicate key race */ }
  }

  return { response: responseData, status: 201 };
}

/**
 * Confirms a reservation — deducts stock permanently.
 */
export async function confirmReservation(reservationId: string, idempotencyKey?: string) {
  const now = new Date();

  if (idempotencyKey) {
    const existing = await sql`
      SELECT * FROM "IdempotencyRecord" WHERE key = ${idempotencyKey}
    `;
    if (existing.length > 0) {
      const record = existing[0];
      if (now > new Date(record.expiresAt)) {
        await sql`DELETE FROM "IdempotencyRecord" WHERE key = ${idempotencyKey}`;
      } else {
        return { response: JSON.parse(record.responseBody), status: record.statusCode };
      }
    }
  }

  const resQuery = await sql`
    SELECT * FROM "Reservation" WHERE id = ${reservationId}
  `;

  if (resQuery.length === 0) {
    return { response: { error: 'Reservation not found.' }, status: 404 };
  }

  const reservation = resQuery[0];

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
      await sql`
        UPDATE "Reservation" SET status = 'EXPIRED', "releasedAt" = ${now}
        WHERE id = ${reservationId} AND status = 'PENDING'
      `;
      await sql`
        UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" - ${reservation.quantity}
        WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
      `;
    }
    return { response: { error: 'Reservation has expired. Inventory returned to available stock.' }, status: 410 };
  }

  // Atomic confirm — only succeeds if still PENDING
  const confirmed = await sql`
    UPDATE "Reservation" SET status = 'CONFIRMED', "confirmedAt" = ${now}
    WHERE id = ${reservationId} AND status = 'PENDING'
    RETURNING id
  `;

  if (confirmed.length === 0) {
    return { response: { error: 'Reservation could not be confirmed (concurrent state change).' }, status: 409 };
  }

  // Permanently deduct stock
  await sql`
    UPDATE "Inventory" SET "totalUnits" = "totalUnits" - ${reservation.quantity}, "reservedUnits" = "reservedUnits" - ${reservation.quantity}
    WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
  `;

  const responseData = { message: 'Reservation confirmed. Stock permanently deducted.', reservationId, status: 'CONFIRMED' };

  if (idempotencyKey) {
    try {
      await sql`
        INSERT INTO "IdempotencyRecord" (key, "responseBody", "statusCode", "expiresAt", "createdAt")
        VALUES (${idempotencyKey}, ${JSON.stringify(responseData)}, ${200}, ${new Date(now.getTime() + 24 * 60 * 60 * 1000)}, ${now})
        ON CONFLICT (key) DO NOTHING
      `;
    } catch { /* ignore */ }
  }

  return { response: responseData, status: 200 };
}

/**
 * Releases a reservation — restores reserved stock.
 */
export async function releaseReservation(reservationId: string) {
  const now = new Date();

  const resQuery = await sql`
    SELECT * FROM "Reservation" WHERE id = ${reservationId}
  `;

  if (resQuery.length === 0) {
    return { response: { error: 'Reservation not found.' }, status: 404 };
  }

  const reservation = resQuery[0];

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
  const released = await sql`
    UPDATE "Reservation" SET status = 'RELEASED', "releasedAt" = ${now}
    WHERE id = ${reservationId} AND status = 'PENDING'
    RETURNING id
  `;

  if (released.length === 0) {
    return { response: { message: 'Reservation already resolved.', reservationId }, status: 200 };
  }

  await sql`
    UPDATE "Inventory" SET "reservedUnits" = "reservedUnits" - ${reservation.quantity}
    WHERE "productId" = ${reservation.productId} AND "warehouseId" = ${reservation.warehouseId}
  `;

  return {
    response: { message: 'Reservation released. Stock returned to available pool.', reservationId, status: 'RELEASED' },
    status: 200,
  };
}
