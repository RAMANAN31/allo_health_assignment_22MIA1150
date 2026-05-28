import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { lazyCleanupExpiredReservations } from '@/lib/reservation-service';
import { Prisma } from '@prisma/client';

export const dynamic = 'force-dynamic';

// Define standard Prisma query payload type with includes for type safety
type ProductWithInventory = Prisma.ProductGetPayload<{
  include: {
    inventory: {
      include: {
        warehouse: true;
      };
    };
  };
}>;

export async function GET() {
  try {
    // 1. Run lazy cleanup of expired reservations before returning data to ensure accuracy
    await lazyCleanupExpiredReservations();

    // 2. Fetch products alongside their complete inventory mappings and warehouse names
    const products = await prisma.product.findMany({
      include: {
        inventory: {
          include: {
            warehouse: true,
          },
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    // 3. Format the response to calculate dynamic stats
    const formattedProducts = (products as ProductWithInventory[]).map((product) => {
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
