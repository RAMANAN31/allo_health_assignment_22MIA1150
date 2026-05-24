import { NextResponse } from 'next/server';
import { prisma } from '@/lib/db';

export async function POST() {
  try {
    console.log('[API Seed] Clearing database tables...');
    
    // Clean in correct dependency order
    await prisma.idempotencyRecord.deleteMany();
    await prisma.reservation.deleteMany();
    await prisma.inventory.deleteMany();
    await prisma.warehouse.deleteMany();
    await prisma.product.deleteMany();

    console.log('[API Seed] Seeding Products...');
    const product1 = await prisma.product.create({
      data: {
        name: 'Vortex Pro Wireless Headphones',
        sku: 'VORTEX-PRO-001',
        description: 'Noise-cancelling high-fidelity wireless over-ear headphones with 40-hour battery life.',
      },
    });

    const product2 = await prisma.product.create({
      data: {
        name: 'Apex Mechanical Keyboard',
        sku: 'APEX-MECH-002',
        description: 'Hot-swappable mechanical keyboard with custom linear switches and RGB backlighting.',
      },
    });

    const product3 = await prisma.product.create({
      data: {
        name: 'Aero Ergonomic Office Chair',
        sku: 'AERO-CHAIR-003',
        description: 'Premium mesh ergonomic chair with 3D armrests and lumbar support.',
      },
    });

    console.log('[API Seed] Seeding Warehouses...');
    const warehouseEast = await prisma.warehouse.create({
      data: {
        name: 'East Coast Fulfillment Center',
        location: 'New York, NY',
      },
    });

    const warehouseWest = await prisma.warehouse.create({
      data: {
        name: 'West Coast Logistics Hub',
        location: 'Los Angeles, CA',
      },
    });

    const warehouseCentral = await prisma.warehouse.create({
      data: {
        name: 'Midwest Distribution Center',
        location: 'Chicago, IL',
      },
    });

    console.log('[API Seed] Seeding Inventory Stock breakdowns...');
    // Vortex Headphones:
    // East: 15 units
    // West: 8 units
    // Central: 0 units (out of stock)
    await prisma.inventory.createMany({
      data: [
        { productId: product1.id, warehouseId: warehouseEast.id, totalUnits: 15, reservedUnits: 0 },
        { productId: product1.id, warehouseId: warehouseWest.id, totalUnits: 8, reservedUnits: 0 },
        { productId: product1.id, warehouseId: warehouseCentral.id, totalUnits: 0, reservedUnits: 0 },
      ],
    });

    // Apex Keyboard:
    // East: 5 units
    // West: 12 units
    // Central: 20 units
    await prisma.inventory.createMany({
      data: [
        { productId: product2.id, warehouseId: warehouseEast.id, totalUnits: 5, reservedUnits: 0 },
        { productId: product2.id, warehouseId: warehouseWest.id, totalUnits: 12, reservedUnits: 0 },
        { productId: product2.id, warehouseId: warehouseCentral.id, totalUnits: 20, reservedUnits: 0 },
      ],
    });

    // Aero Chair:
    // East: 2 units (low stock!)
    // West: 0 units
    // Central: 1 units
    await prisma.inventory.createMany({
      data: [
        { productId: product3.id, warehouseId: warehouseEast.id, totalUnits: 2, reservedUnits: 0 },
        { productId: product3.id, warehouseId: warehouseWest.id, totalUnits: 0, reservedUnits: 0 },
        { productId: product3.id, warehouseId: warehouseCentral.id, totalUnits: 1, reservedUnits: 0 },
      ],
    });

    console.log('[API Seed] Database seeding completed successfully!');
    return NextResponse.json({ success: true, message: 'Database successfully seeded.' }, { status: 201 });
  } catch (error: any) {
    console.error('[API Seed] Seeding Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
