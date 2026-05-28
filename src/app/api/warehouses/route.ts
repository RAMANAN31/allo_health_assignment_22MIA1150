import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const result = await pool.query('SELECT * FROM "Warehouse" ORDER BY name ASC');
    const warehouses = result.rows;

    return NextResponse.json({ warehouses }, { status: 200 });
  } catch (error) {
    console.error('[API] GET /api/warehouses error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
