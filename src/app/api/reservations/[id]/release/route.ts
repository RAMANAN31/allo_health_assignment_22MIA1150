import { NextRequest, NextResponse } from 'next/server';
import { releaseReservation } from '@/lib/reservation-service';

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

    // Call business logic to lock, verify pending state, and release stock
    const { response, status } = await releaseReservation(id);

    return NextResponse.json(response, { status });
  } catch (error) {
    console.error(`[API] POST /api/reservations/${id}/release error:`, error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
