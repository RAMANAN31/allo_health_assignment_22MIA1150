import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import { lazyCleanupExpiredReservations } from '@/lib/reservation-service';

export const dynamic = 'force-dynamic';

interface ProductWithInventory {
  id: string;
  name: string;
  sku: string;
  description: string | null;
  inventory: {
    warehouseId: string;
    totalUnits: number;
    reservedUnits: number;
    warehouse: {
      name: string;
      location: string;
    };
  }[];
}

export async function GET() {
  try {
    // 1. Run lazy cleanup of expired reservations before returning data to ensure accuracy
    await lazyCleanupExpiredReservations();

    // 2. Fetch products alongside their complete inventory mappings and warehouse names using a JOIN query
    const result = await pool.query(`
      SELECT 
        p.id as "productId",
        p.name as "productName",
        p.sku as "productSku",
        p.description as "productDescription",
        i."totalUnits",
        i."reservedUnits",
        w.id as "warehouseId",
        w.name as "warehouseName",
        w.location as "warehouseLocation"
      FROM "Product" p
      LEFT JOIN "Inventory" i ON p.id = i."productId"
      LEFT JOIN "Warehouse" w ON i."warehouseId" = w.id
      ORDER BY p."createdAt" ASC;
    `);

    // Group the flat join rows into nested product structures
    const productMap = new Map<string, ProductWithInventory>();

    for (const row of result.rows) {
      if (!productMap.has(row.productId)) {
        productMap.set(row.productId, {
          id: row.productId,
          name: row.productName,
          sku: row.productSku,
          description: row.productDescription,
          inventory: []
        });
      }
      
      if (row.warehouseId) {
        productMap.get(row.productId)!.inventory.push({
          warehouseId: row.warehouseId,
          totalUnits: row.totalUnits,
          reservedUnits: row.reservedUnits,
          warehouse: {
            name: row.warehouseName,
            location: row.warehouseLocation
          }
        });
      }
    }

    const products = Array.from(productMap.values());

    // 3. Format the response to calculate dynamic stats
    const formattedProducts = products.map((product) => {
      let totalStock = 0;
      let totalReserved = 0;

      const stockBreakdown = product.inventory.map((inv) => {
        const available = inv.totalUnits - inv.reservedUnits;
        totalStock += inv.totalUnits;
        totalReserved += inv.reservedUnits;

        return {
          warehouseId: inv.warehouseId,
          warehouseName: inv.warehouse.name,
          location: inv.warehouse.location,
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
