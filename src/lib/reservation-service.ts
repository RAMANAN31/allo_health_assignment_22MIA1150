import { supabase } from './db';
import crypto from 'crypto';

/**
 * Lazy cleanup of expired reservations.
 * Scans for reservations that are still PENDING but past their expiresAt date.
 */
export async function lazyCleanupExpiredReservations() {
  const now = new Date().toISOString();

  // Find expired reservations
  const { data: expired, error: fetchError } = await supabase
    .from('Reservation')
    .select('*')
    .eq('status', 'PENDING')
    .lt('expiresAt', now);

  if (fetchError) {
    console.error(`[Lazy Cleanup] Error fetching expired reservations:`, fetchError);
    return;
  }
  
  if (!expired || expired.length === 0) return;

  console.log(`[Lazy Cleanup] Found ${expired.length} expired reservations to clean up.`);

  for (const res of expired) {
    try {
      // Atomic update: only proceed if still PENDING
      const { data: updated, error: updateError } = await supabase
        .from('Reservation')
        .update({ status: 'EXPIRED', releasedAt: now })
        .eq('id', res.id)
        .eq('status', 'PENDING')
        .select('id');

      if (updated && updated.length > 0) {
        // Fetch inventory to get current reservedUnits
        const { data: invData } = await supabase
          .from('Inventory')
          .select('reservedUnits')
          .eq('productId', res.productId)
          .eq('warehouseId', res.warehouseId)
          .single();
          
        if (invData) {
          await supabase
            .from('Inventory')
            .update({ reservedUnits: Math.max(0, invData.reservedUnits - res.quantity) })
            .eq('productId', res.productId)
            .eq('warehouseId', res.warehouseId);
            
          console.log(`[Lazy Cleanup] Expired reservation ${res.id}, restored ${res.quantity} units.`);
        }
      }
    } catch (err) {
      console.error(`[Lazy Cleanup] Failed for reservation ${res.id}:`, err);
    }
  }
}

/**
 * Creates a new inventory reservation.
 * Uses optimistic concurrency control.
 */
export async function createReservation(
  productId: string,
  warehouseId: string,
  quantity: number,
  idempotencyKey?: string
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
  const nowIso = now.toISOString();

  // 1. Check Idempotency Key
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('IdempotencyRecord')
      .select('*')
      .eq('key', idempotencyKey);
      
    if (existing && existing.length > 0) {
      const record = existing[0];
      if (now > new Date(record.expiresAt)) {
        await supabase.from('IdempotencyRecord').delete().eq('key', idempotencyKey);
      } else {
        return { response: JSON.parse(record.responseBody), status: record.statusCode };
      }
    }
  }

  // 2. Run lazy cleanup to free up any expired stock
  await lazyCleanupExpiredReservations();

  // 3. Read current inventory snapshot
  const { data: invRes, error: invError } = await supabase
    .from('Inventory')
    .select('*')
    .eq('productId', productId)
    .eq('warehouseId', warehouseId);

  if (!invRes || invRes.length === 0) {
    return { response: { error: 'No inventory record found for the given product and warehouse.' }, status: 404 };
  }

  const inventory = invRes[0];
  const available = inventory.totalUnits - inventory.reservedUnits;
  if (available < quantity) {
    const resp = { error: 'Insufficient stock available in the selected warehouse.' };
    if (idempotencyKey) {
      // Best effort idempotency insert
      await supabase.from('IdempotencyRecord').insert({
        key: idempotencyKey,
        responseBody: JSON.stringify(resp),
        statusCode: 409,
        expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
        createdAt: nowIso
      });
    }
    return { response: resp, status: 409 };
  }

  // 4. Atomic conditional update
  const { data: updated, error: updateError } = await supabase
    .from('Inventory')
    .update({ reservedUnits: inventory.reservedUnits + quantity })
    .eq('productId', productId)
    .eq('warehouseId', warehouseId)
    .eq('reservedUnits', inventory.reservedUnits)
    .gte('totalUnits', inventory.reservedUnits + quantity)
    .select('id');

  // 5. If 0 rows returned, conflict!
  if (!updated || updated.length === 0) {
    const resp = { error: 'Insufficient stock available in the selected warehouse (concurrent update).' };
    return { response: resp, status: 409 };
  }

  // 6. Create the Reservation record
  const reservationId = crypto.randomUUID();
  await supabase.from('Reservation').insert({
    id: reservationId,
    productId,
    warehouseId,
    quantity,
    status: 'PENDING',
    expiresAt,
    createdAt: nowIso,
    idempotencyKey: idempotencyKey || null
  });

  const responseData = { reservationId, expiresAt };

  if (idempotencyKey) {
    await supabase.from('IdempotencyRecord').insert({
      key: idempotencyKey,
      responseBody: JSON.stringify(responseData),
      statusCode: 201,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: nowIso
    });
  }

  return { response: responseData, status: 201 };
}

/**
 * Confirms a reservation — deducts stock permanently.
 */
export async function confirmReservation(reservationId: string, idempotencyKey?: string) {
  const now = new Date();
  const nowIso = now.toISOString();

  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from('IdempotencyRecord')
      .select('*')
      .eq('key', idempotencyKey);
      
    if (existing && existing.length > 0) {
      const record = existing[0];
      if (now > new Date(record.expiresAt)) {
        await supabase.from('IdempotencyRecord').delete().eq('key', idempotencyKey);
      } else {
        return { response: JSON.parse(record.responseBody), status: record.statusCode };
      }
    }
  }

  const { data: resQuery } = await supabase
    .from('Reservation')
    .select('*')
    .eq('id', reservationId);

  if (!resQuery || resQuery.length === 0) {
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

  // Check expiry
  const isExpired = reservation.status === 'EXPIRED' || now > new Date(reservation.expiresAt);
  if (isExpired) {
    if (reservation.status === 'PENDING') {
      await supabase
        .from('Reservation')
        .update({ status: 'EXPIRED', releasedAt: nowIso })
        .eq('id', reservationId)
        .eq('status', 'PENDING');
        
      // Fetch inventory to properly restore stock
      const { data: invData } = await supabase
          .from('Inventory')
          .select('reservedUnits')
          .eq('productId', reservation.productId)
          .eq('warehouseId', reservation.warehouseId)
          .single();
          
      if (invData) {
        await supabase
          .from('Inventory')
          .update({ reservedUnits: Math.max(0, invData.reservedUnits - reservation.quantity) })
          .eq('productId', reservation.productId)
          .eq('warehouseId', reservation.warehouseId);
      }
    }
    return { response: { error: 'Reservation has expired. Inventory returned to available stock.' }, status: 410 };
  }

  // Atomic confirm
  const { data: confirmed } = await supabase
    .from('Reservation')
    .update({ status: 'CONFIRMED', confirmedAt: nowIso })
    .eq('id', reservationId)
    .eq('status', 'PENDING')
    .select('id');

  if (!confirmed || confirmed.length === 0) {
    return { response: { error: 'Reservation could not be confirmed (concurrent state change).' }, status: 409 };
  }

  // Permanently deduct stock
  // Fetch current inventory first
  const { data: currentInv } = await supabase
    .from('Inventory')
    .select('totalUnits, reservedUnits')
    .eq('productId', reservation.productId)
    .eq('warehouseId', reservation.warehouseId)
    .single();

  if (currentInv) {
    await supabase
      .from('Inventory')
      .update({ 
        totalUnits: Math.max(0, currentInv.totalUnits - reservation.quantity),
        reservedUnits: Math.max(0, currentInv.reservedUnits - reservation.quantity)
      })
      .eq('productId', reservation.productId)
      .eq('warehouseId', reservation.warehouseId);
  }

  const responseData = { message: 'Reservation confirmed. Stock permanently deducted.', reservationId, status: 'CONFIRMED' };

  if (idempotencyKey) {
    await supabase.from('IdempotencyRecord').insert({
      key: idempotencyKey,
      responseBody: JSON.stringify(responseData),
      statusCode: 200,
      expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
      createdAt: nowIso
    });
  }

  return { response: responseData, status: 200 };
}

/**
 * Releases a reservation — restores reserved stock.
 */
export async function releaseReservation(reservationId: string) {
  const now = new Date();
  const nowIso = now.toISOString();

  const { data: resQuery } = await supabase
    .from('Reservation')
    .select('*')
    .eq('id', reservationId);

  if (!resQuery || resQuery.length === 0) {
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

  // Atomic release
  const { data: released } = await supabase
    .from('Reservation')
    .update({ status: 'RELEASED', releasedAt: nowIso })
    .eq('id', reservationId)
    .eq('status', 'PENDING')
    .select('id');

  if (!released || released.length === 0) {
    return { response: { message: 'Reservation already resolved.', reservationId }, status: 200 };
  }

  // Fetch current inventory first
  const { data: currentInv } = await supabase
    .from('Inventory')
    .select('reservedUnits')
    .eq('productId', reservation.productId)
    .eq('warehouseId', reservation.warehouseId)
    .single();

  if (currentInv) {
    await supabase
      .from('Inventory')
      .update({ reservedUnits: Math.max(0, currentInv.reservedUnits - reservation.quantity) })
      .eq('productId', reservation.productId)
      .eq('warehouseId', reservation.warehouseId);
  }

  return {
    response: { message: 'Reservation released. Stock returned to available pool.', reservationId, status: 'RELEASED' },
    status: 200,
  };
}
