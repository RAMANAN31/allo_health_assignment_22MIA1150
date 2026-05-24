import { NextRequest, NextResponse } from 'next/server';
import { confirmReservation } from '@/lib/reservation-service';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let id = '';
  try {
    const resolvedParams = await params;
    id = resolvedParams.id;

    if (!id) {
      return NextResponse.json({ error: 'Reservation ID is required' }, { status: 400 });
    }

    const idempotencyKey = request.headers.get('x-idempotency-key') || undefined;

    // Call business logic to lock, check expiration, confirm and deduct stock
    const { response, status } = await confirmReservation(id, idempotencyKey);

    return NextResponse.json(response, { status });
  } catch (error) {
    console.error(`[API] POST /api/reservations/${id}/confirm error:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
