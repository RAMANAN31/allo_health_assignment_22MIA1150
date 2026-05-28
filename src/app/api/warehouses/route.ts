import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const warehouses = await sql`SELECT * FROM "Warehouse" ORDER BY name ASC`;

    return NextResponse.json({ warehouses }, { status: 200 });
  } catch (error) {
    console.error('[API] GET /api/warehouses error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
