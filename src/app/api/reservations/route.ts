import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { sql } from '@/lib/db';
import { createReservation, lazyCleanupExpiredReservations } from '@/lib/reservation-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Run lazy cleanup before returning reservations
    await lazyCleanupExpiredReservations();

    // 2. Fetch the 50 most recent reservations with nested product and warehouse details
    const reservations = await sql`
      SELECT 
        r.id,
        r."productId",
        r."warehouseId",
        r.quantity,
        r.status,
        r."expiresAt",
        r."createdAt",
        r."confirmedAt",
        r."releasedAt",
        r."idempotencyKey",
        json_build_object('name', p.name, 'sku', p.sku) as product,
        json_build_object('name', w.name, 'location', w.location) as warehouse
      FROM "Reservation" r
      JOIN "Product" p ON r."productId" = p.id
      JOIN "Warehouse" w ON r."warehouseId" = w.id
      ORDER BY r."createdAt" DESC
      LIMIT 50
    `;

    return NextResponse.json({ reservations }, { status: 200 });
  } catch (error) {
    console.error('[API] GET /api/reservations error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}

// Zod schema for validating the incoming request body
const reservationSchema = z.object({
  productId: z.string().min(1, 'Product ID is required'),
  warehouseId: z.string().min(1, 'Warehouse ID is required'),
  quantity: z.number().int().positive('Quantity must be a positive integer'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // 1. Validate the request body
    const parseResult = reservationSchema.safeParse(body);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Validation Error', details: parseResult.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { productId, warehouseId, quantity } = parseResult.data;

    // 2. Extract optional Idempotency Key from request headers
    const idempotencyKey = request.headers.get('x-idempotency-key') || undefined;

    // 3. Call the concurrency-safe reservation service
    const { response, status } = await createReservation(
      productId,
      warehouseId,
      quantity,
      idempotencyKey
    );

    return NextResponse.json(response, { status });
  } catch (error) {
    console.error('[API] POST /api/reservations error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
