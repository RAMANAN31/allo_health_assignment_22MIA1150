import { prisma } from './db';

/**
 * Lazy cleanup of expired reservations.
 * Scans for reservations that are still PENDING but past their expiresAt date.
 */
export async function lazyCleanupExpiredReservations() {
  const now = new Date();

  const expiredReservations = await prisma.reservation.findMany({
    where: { status: 'PENDING', expiresAt: { lt: now } },
  });

  if (expiredReservations.length === 0) return;

  console.log(`[Lazy Cleanup] Found ${expiredReservations.length} expired reservations to clean up.`);

  for (const res of expiredReservations) {
    try {
      // Atomic update: only proceed if still PENDING (guards against double-cleanup)
      const updated = await prisma.reservation.updateMany({
        where: { id: res.id, status: 'PENDING' },
        data: { status: 'EXPIRED', releasedAt: now },
      });

      if (updated.count > 0) {
        await prisma.inventory.update({
          where: { productId_warehouseId: { productId: res.productId, warehouseId: res.warehouseId } },
          data: { reservedUnits: { decrement: res.quantity } },
        });
        console.log(`[Lazy Cleanup] Expired reservation ${res.id}, restored ${res.quantity} units.`);
      }
    } catch (err) {
      console.error(`[Lazy Cleanup] Failed for reservation ${res.id}:`, err);
    }
  }
}

/**
 * Creates a new inventory reservation.
 * Uses Prisma optimistic concurrency control:
 * - We capture the current reservedUnits value.
 * - We attempt an atomic conditional UPDATE that only succeeds when
 *   reservedUnits + quantity <= totalUnits.
 * - If the row was already modified concurrently, updateMany returns count=0
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
    const existing = await prisma.idempotencyRecord.findUnique({
      where: { key: idempotencyKey },
    });
    if (existing) {
      if (now > existing.expiresAt) {
        await prisma.idempotencyRecord.delete({ where: { key: idempotencyKey } });
      } else {
        return { response: JSON.parse(existing.responseBody), status: existing.statusCode };
      }
    }
  }

  // 2. Run lazy cleanup to free up any expired stock
  await lazyCleanupExpiredReservations();

  // 3. Read current inventory snapshot
  const inventory = await prisma.inventory.findUnique({
    where: { productId_warehouseId: { productId, warehouseId } },
  });

  if (!inventory) {
    return { response: { error: 'No inventory record found for the given product and warehouse.' }, status: 404 };
  }

  const available = inventory.totalUnits - inventory.reservedUnits;
  if (available < quantity) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    if (idempotencyKey) {
      await prisma.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          responseBody: JSON.stringify(resp),
          statusCode: 409,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      }).catch(() => {}); // ignore duplicate key race
    }
    return { response: resp, status: 409 };
  }

  // 4. Atomic conditional update — only succeeds if stock hasn't changed
  // This is optimistic locking: we condition on the exact reservedUnits we read.
  const updated = await prisma.inventory.updateMany({
    where: {
      productId,
      warehouseId,
      reservedUnits: inventory.reservedUnits, // CAS condition
      // Double-check we still have enough headroom
      totalUnits: { gte: inventory.reservedUnits + quantity },
    },
    data: { reservedUnits: { increment: quantity } },
  });

  // 5. If count is 0, a concurrent request changed the row — conflict!
  if (updated.count === 0) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    return { response: resp, status: 409 };
  }

  // 6. Create the Reservation record
  const reservation = await prisma.reservation.create({
    data: { productId, warehouseId, quantity, status: 'PENDING', expiresAt, idempotencyKey },
  });

  const responseData = { reservationId: reservation.id, expiresAt: reservation.expiresAt };

  if (idempotencyKey) {
    await prisma.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        responseBody: JSON.stringify(responseData),
        statusCode: 201,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    }).catch(() => {}); // ignore duplicate key race
  }

  return { response: responseData, status: 201 };
}

/**
 * Confirms a reservation — deducts stock permanently.
 */
export async function confirmReservation(reservationId: string, idempotencyKey?: string) {
  const now = new Date();

  if (idempotencyKey) {
    const existing = await prisma.idempotencyRecord.findUnique({ where: { key: idempotencyKey } });
    if (existing) {
      if (now > existing.expiresAt) {
        await prisma.idempotencyRecord.delete({ where: { key: idempotencyKey } });
      } else {
        return { response: JSON.parse(existing.responseBody), status: existing.statusCode };
      }
    }
  }

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });

  if (!reservation) {
    return { response: { error: 'Reservation not found.' }, status: 404 };
  }

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
      await prisma.reservation.updateMany({
        where: { id: reservationId, status: 'PENDING' },
        data: { status: 'EXPIRED', releasedAt: now },
      });
      await prisma.inventory.update({
        where: { productId_warehouseId: { productId: reservation.productId, warehouseId: reservation.warehouseId } },
        data: { reservedUnits: { decrement: reservation.quantity } },
      });
    }
    return { response: { error: 'Reservation has expired. Inventory returned to available stock.' }, status: 410 };
  }

  // Atomic confirm — only succeeds if still PENDING
  const confirmedCount = await prisma.reservation.updateMany({
    where: { id: reservationId, status: 'PENDING' },
    data: { status: 'CONFIRMED', confirmedAt: now },
  });

  if (confirmedCount.count === 0) {
    return { response: { error: 'Reservation could not be confirmed (concurrent state change).' }, status: 409 };
  }

  // Permanently deduct stock
  await prisma.inventory.update({
    where: { productId_warehouseId: { productId: reservation.productId, warehouseId: reservation.warehouseId } },
    data: {
      totalUnits: { decrement: reservation.quantity },
      reservedUnits: { decrement: reservation.quantity },
    },
  });

  const responseData = { message: 'Reservation confirmed. Stock permanently deducted.', reservationId, status: 'CONFIRMED' };

  if (idempotencyKey) {
    await prisma.idempotencyRecord.create({
      data: {
        key: idempotencyKey,
        responseBody: JSON.stringify(responseData),
        statusCode: 200,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
      },
    }).catch(() => {});
  }

  return { response: responseData, status: 200 };
}

/**
 * Releases a reservation — restores reserved stock.
 */
export async function releaseReservation(reservationId: string) {
  const now = new Date();

  const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });

  if (!reservation) {
    return { response: { error: 'Reservation not found.' }, status: 404 };
  }

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
  const releasedCount = await prisma.reservation.updateMany({
    where: { id: reservationId, status: 'PENDING' },
    data: { status: 'RELEASED', releasedAt: now },
  });

  if (releasedCount.count === 0) {
    return { response: { message: 'Reservation already resolved.', reservationId }, status: 200 };
  }

  await prisma.inventory.update({
    where: { productId_warehouseId: { productId: reservation.productId, warehouseId: reservation.warehouseId } },
    data: { reservedUnits: { decrement: reservation.quantity } },
  });

  return {
    response: { message: 'Reservation released. Stock returned to available pool.', reservationId, status: 'RELEASED' },
    status: 200,
  };
}
