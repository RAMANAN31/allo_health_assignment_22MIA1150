import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { data: warehouses, error } = await supabase
      .from('Warehouse')
      .select('*')
      .order('name', { ascending: true });

    if (error) {
      console.error('[API] GET /api/warehouses fetch error:', error);
      return NextResponse.json({ error: 'Database fetch error' }, { status: 500 });
    }

    return NextResponse.json({ warehouses }, { status: 200 });
  } catch (error) {
    console.error('[API] GET /api/warehouses error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
