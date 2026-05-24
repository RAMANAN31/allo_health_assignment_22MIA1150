import { prisma } from './db';
import { ReservationStatus } from '@prisma/client';

/**
 * Lazy cleanup of expired reservations.
 * Scans for reservations that are still PENDING but past their expiresAt date,
 * then atomically restores their inventory and marks them as EXPIRED.
 */
export async function lazyCleanupExpiredReservations() {
  const now = new Date();
  
  // Find all reservations that are expired but still marked as PENDING
  const expiredReservations = await prisma.reservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now },
    },
  });

  if (expiredReservations.length === 0) return;

  console.log(`[Lazy Cleanup] Found ${expiredReservations.length} expired reservations to clean up.`);

  for (const res of expiredReservations) {
    try {
      await prisma.$transaction(async (tx) => {
        // Lock reservation row if possible
        let reservation;
        try {
          const resLock = await tx.$queryRaw<any[]>`
            SELECT * FROM "Reservation" WHERE "id" = ${res.id} FOR UPDATE
          `;
          reservation = resLock?.[0];
        } catch (e) {
          reservation = await tx.reservation.findUnique({
            where: { id: res.id },
          });
        }

        // If it's no longer pending, skip it
        if (!reservation || reservation.status !== 'PENDING') return;

        // 1. Mark reservation as expired
        await tx.reservation.update({
          where: { id: res.id },
          data: {
            status: 'EXPIRED',
            releasedAt: now,
          },
        });

        // 2. Return the reserved units back to available stock
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: res.productId,
              warehouseId: res.warehouseId,
            },
          },
          data: {
            reservedUnits: { decrement: res.quantity },
          },
        });
      });
      console.log(`[Lazy Cleanup] Successfully expired reservation ${res.id} and returned ${res.quantity} stock.`);
    } catch (err) {
      console.error(`[Lazy Cleanup] Failed to clean up reservation ${res.id}:`, err);
    }
  }
}

/**
 * Creates a new inventory reservation.
 * Implements concurrency-safe stock checking and booking.
 */
export async function createReservation(
  productId: string,
  warehouseId: string,
  quantity: number,
  idempotencyKey?: string
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // 10 minutes expiry

  // 1. Check Idempotency Key
  if (idempotencyKey) {
    const existingRecord = await prisma.idempotencyRecord.findUnique({
      where: { key: idempotencyKey },
    });
    if (existingRecord) {
      // If the idempotency record itself is expired, delete and proceed
      if (new Date() > existingRecord.expiresAt) {
        await prisma.idempotencyRecord.delete({ where: { key: idempotencyKey } });
      } else {
        console.log(`[Idempotency] Match found for key: ${idempotencyKey}`);
        return {
          response: JSON.parse(existingRecord.responseBody),
          status: existingRecord.statusCode,
        };
      }
    }
  }

  // 2. Perform lazy cleanup first to make sure stock quantities are fully up to date
  await lazyCleanupExpiredReservations();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 3. Acquire atomic row-level lock on Inventory for this product-warehouse
      let inventory;
      try {
        const inventoryLock = await tx.$queryRaw<any[]>`
          SELECT * FROM "Inventory"
          WHERE "productId" = ${productId} AND "warehouseId" = ${warehouseId}
          FOR UPDATE
        `;
        inventory = inventoryLock?.[0];
      } catch (err) {
        // Fallback for SQLite which doesn't support FOR UPDATE row locking
        // SQLite will serialize this transaction at database connection level
        inventory = await tx.inventory.findUnique({
          where: {
            productId_warehouseId: {
              productId,
              warehouseId,
            },
          },
        });
      }

      if (!inventory) {
        throw new Error('INVENTORY_NOT_FOUND');
      }

      // 4. Calculate stock availability
      const availableUnits = inventory.totalUnits - inventory.reservedUnits;
      if (availableUnits < quantity) {
        throw new Error('INSUFFICIENT_STOCK');
      }

      // 5. Atomic increment of reservedUnits
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId,
            warehouseId,
          },
        },
        data: {
          reservedUnits: { increment: quantity },
        },
      });

      // 6. Create Reservation
      const reservation = await tx.reservation.create({
        data: {
          productId,
          warehouseId,
          quantity,
          status: 'PENDING',
          expiresAt,
          idempotencyKey,
        },
      });

      return {
        reservationId: reservation.id,
        expiresAt: reservation.expiresAt,
      };
    });

    const responseData = {
      reservationId: result.reservationId,
      expiresAt: result.expiresAt,
    };

    // 7. Store successful response for idempotency
    if (idempotencyKey) {
      await prisma.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          responseBody: JSON.stringify(responseData),
          statusCode: 201,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000), // 24hr duration
        },
      });
    }

    return { response: responseData, status: 201 };

  } catch (error: any) {
    if (error.message === 'INSUFFICIENT_STOCK') {
      const responseData = { error: 'Insufficient stock available in the selected warehouse.' };
      if (idempotencyKey) {
        await prisma.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            responseBody: JSON.stringify(responseData),
            statusCode: 409,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
      }
      return { response: responseData, status: 409 };
    }

    if (error.message === 'INVENTORY_NOT_FOUND') {
      return { response: { error: 'No inventory record exists for the given Product and Warehouse.' }, status: 404 };
    }

    console.error('[Service] Create Reservation Error:', error);
    return { response: { error: 'Internal Server Error' }, status: 500 };
  }
}

/**
 * Confirms a reservation and permanently deducts inventory.
 */
export async function confirmReservation(reservationId: string, idempotencyKey?: string) {
  const now = new Date();

  // 1. Check Idempotency Key
  if (idempotencyKey) {
    const existingRecord = await prisma.idempotencyRecord.findUnique({
      where: { key: idempotencyKey },
    });
    if (existingRecord) {
      if (new Date() > existingRecord.expiresAt) {
        await prisma.idempotencyRecord.delete({ where: { key: idempotencyKey } });
      } else {
        console.log(`[Idempotency] Match found for key: ${idempotencyKey}`);
        return {
          response: JSON.parse(existingRecord.responseBody),
          status: existingRecord.statusCode,
        };
      }
    }
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 2. Lock Reservation Row
      let reservation;
      try {
        const resLock = await tx.$queryRaw<any[]>`
          SELECT * FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE
        `;
        reservation = resLock?.[0];
      } catch (e) {
        reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
        });
      }

      if (!reservation) {
        throw new Error('RESERVATION_NOT_FOUND');
      }

      // Check existing statuses
      if (reservation.status === 'CONFIRMED') {
        return {
          reservationId: reservation.id,
          status: 'CONFIRMED',
          alreadyConfirmed: true,
        };
      }

      if (reservation.status === 'EXPIRED') {
        throw new Error('RESERVATION_EXPIRED');
      }

      if (reservation.status === 'RELEASED') {
        throw new Error('RESERVATION_RELEASED');
      }

      // Check if expired by time
      if (new Date() > new Date(reservation.expiresAt)) {
        // Expire reservation atomically inside transaction
        await tx.reservation.update({
          where: { id: reservationId },
          data: {
            status: 'EXPIRED',
            releasedAt: now,
          },
        });

        // Release the units back
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: reservation.productId,
              warehouseId: reservation.warehouseId,
            },
          },
          data: {
            reservedUnits: { decrement: reservation.quantity },
          },
        });

        throw new Error('RESERVATION_EXPIRED');
      }

      // 3. Update reservation status to CONFIRMED
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'CONFIRMED',
          confirmedAt: now,
        },
      });

      // 4. Permanently deduct stock (decrease total units and decrement reservedUnits)
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          totalUnits: { decrement: reservation.quantity },
          reservedUnits: { decrement: reservation.quantity },
        },
      });

      return {
        reservationId: reservation.id,
        status: 'CONFIRMED',
        alreadyConfirmed: false,
      };
    });

    const responseData = {
      message: 'Reservation confirmed successfully. Stock permanently deducted.',
      reservationId: result.reservationId,
      status: result.status,
    };

    if (idempotencyKey) {
      await prisma.idempotencyRecord.create({
        data: {
          key: idempotencyKey,
          responseBody: JSON.stringify(responseData),
          statusCode: 200,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
    }

    return { response: responseData, status: 200 };

  } catch (error: any) {
    if (error.message === 'RESERVATION_EXPIRED') {
      const responseData = { error: 'Reservation has expired. Inventory returned to available stock.' };
      if (idempotencyKey) {
        await prisma.idempotencyRecord.create({
          data: {
            key: idempotencyKey,
            responseBody: JSON.stringify(responseData),
            statusCode: 410,
            expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
          },
        });
      }
      return { response: responseData, status: 410 };
    }

    if (error.message === 'RESERVATION_RELEASED') {
      return { response: { error: 'Cannot confirm a cancelled or released reservation.' }, status: 400 };
    }

    if (error.message === 'RESERVATION_NOT_FOUND') {
      return { response: { error: 'Reservation details not found.' }, status: 404 };
    }

    console.error('[Service] Confirm Reservation Error:', error);
    return { response: { error: 'Internal Server Error' }, status: 500 };
  }
}

/**
 * Releases a reservation, returning reserved stock back to available pool.
 */
export async function releaseReservation(reservationId: string) {
  const now = new Date();

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Lock Reservation Row
      let reservation;
      try {
        const resLock = await tx.$queryRaw<any[]>`
          SELECT * FROM "Reservation" WHERE "id" = ${reservationId} FOR UPDATE
        `;
        reservation = resLock?.[0];
      } catch (e) {
        reservation = await tx.reservation.findUnique({
          where: { id: reservationId },
        });
      }

      if (!reservation) {
        throw new Error('RESERVATION_NOT_FOUND');
      }

      // If already released, idempotent success
      if (reservation.status === 'RELEASED') {
        return { reservationId: reservation.id, status: 'RELEASED', changed: false };
      }

      if (reservation.status === 'CONFIRMED') {
        throw new Error('CANNOT_RELEASE_CONFIRMED');
      }

      // If already expired, return status (it already released stock)
      if (reservation.status === 'EXPIRED') {
        return { reservationId: reservation.id, status: 'EXPIRED', changed: false };
      }

      // 1. Release reserved stock
      await tx.inventory.update({
        where: {
          productId_warehouseId: {
            productId: reservation.productId,
            warehouseId: reservation.warehouseId,
          },
        },
        data: {
          reservedUnits: { decrement: reservation.quantity },
        },
      });

      // 2. Mark reservation as RELEASED
      await tx.reservation.update({
        where: { id: reservationId },
        data: {
          status: 'RELEASED',
          releasedAt: now,
        },
      });

      return { reservationId: reservation.id, status: 'RELEASED', changed: true };
    });

    return {
      response: {
        message: result.changed ? 'Reservation released. Stock returned to available pool.' : 'Reservation already resolved.',
        reservationId: result.reservationId,
        status: result.status,
      },
      status: 200,
    };

  } catch (error: any) {
    if (error.message === 'CANNOT_RELEASE_CONFIRMED') {
      return { response: { error: 'Cannot cancel or release a reservation that has already been confirmed.' }, status: 400 };
    }

    if (error.message === 'RESERVATION_NOT_FOUND') {
      return { response: { error: 'Reservation details not found.' }, status: 404 };
    }

    console.error('[Service] Release Reservation Error:', error);
    return { response: { error: 'Internal Server Error' }, status: 500 };
  }
}
