import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import { lazyCleanupExpiredReservations } from '@/lib/reservation-service';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Run lazy cleanup of expired reservations before returning data to ensure accuracy
    await lazyCleanupExpiredReservations();

    // 2. Fetch products alongside their complete inventory mappings and warehouse names
    // Supabase will automatically map the foreign keys if set up correctly
    const { data: products, error } = await supabase
      .from('Product')
      .select(`
        id,
        name,
        sku,
        description,
        Inventory (
          warehouseId,
          totalUnits,
          reservedUnits,
          Warehouse (
            name,
            location
          )
        )
      `)
      .order('createdAt', { ascending: true });

    if (error) {
      console.error('[API] GET /api/products error:', error);
      return NextResponse.json({ error: 'Database fetch error' }, { status: 500 });
    }

    // 3. Format the response to calculate dynamic stats
    const formattedProducts = (products || []).map((product: any) => {
      let totalStock = 0;
      let totalReserved = 0;

      const stockBreakdown = (product.Inventory || []).map((inv: any) => {
        const available = inv.totalUnits - inv.reservedUnits;
        totalStock += inv.totalUnits;
        totalReserved += inv.reservedUnits;

        return {
          warehouseId: inv.warehouseId,
          warehouseName: inv.Warehouse?.name || 'Unknown',
          location: inv.Warehouse?.location || 'Unknown',
          totalUnits: inv.totalUnits,
          reservedUnits: inv.reservedUnits,
          availableUnits: Math.max(0, available),
        };
      });

      return {
        id: product.id,
        name: product.name,
        sku: product.sku,
        description: product.description,
        totalStock,
        totalReserved,
        totalAvailable: Math.max(0, totalStock - totalReserved),
        stockBreakdown,
      };
    });

    return NextResponse.json({ products: formattedProducts }, { status: 200 });
  } catch (error) {
    console.error('[API] GET /api/products error:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
