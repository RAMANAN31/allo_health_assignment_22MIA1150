import { NextResponse } from 'next/server';
import { lazyCleanupExpiredReservations } from '@/lib/reservation-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    console.log('[Cron] Running scheduled reservation cleanup worker...');
    
    // Execute bulk check and restore of all pending expired reservations
    await lazyCleanupExpiredReservations();

    return NextResponse.json({
      success: true,
      message: 'Scheduled background cleanup task executed successfully.',
      timestamp: new Date().toISOString(),
    }, { status: 200 });
  } catch (error) {
    console.error('[API] GET /api/cron/cleanup error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
