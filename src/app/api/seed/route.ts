import { NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export async function POST() {
  try {
    console.log('[API Seed] Clearing database tables...');
    
    // Clean in correct dependency order
    await sql`DELETE FROM "IdempotencyRecord"`;
    await sql`DELETE FROM "Reservation"`;
    await sql`DELETE FROM "Inventory"`;
    await sql`DELETE FROM "Warehouse"`;
    await sql`DELETE FROM "Product"`;

    console.log('[API Seed] Seeding Products...');
    const p1Id = crypto.randomUUID();
    const p2Id = crypto.randomUUID();
    const p3Id = crypto.randomUUID();
    const now = new Date();

    await sql`
      INSERT INTO "Product" (id, name, sku, description, "createdAt", "updatedAt")
      VALUES (${p1Id}, ${'Vortex Pro Wireless Headphones'}, ${'VORTEX-PRO-001'}, ${'Noise-cancelling high-fidelity wireless over-ear headphones with 40-hour battery life.'}, ${now}, ${now})
    `;

    await sql`
      INSERT INTO "Product" (id, name, sku, description, "createdAt", "updatedAt")
      VALUES (${p2Id}, ${'Apex Mechanical Keyboard'}, ${'APEX-MECH-002'}, ${'Hot-swappable mechanical keyboard with custom linear switches and RGB backlighting.'}, ${now}, ${now})
    `;

    await sql`
      INSERT INTO "Product" (id, name, sku, description, "createdAt", "updatedAt")
      VALUES (${p3Id}, ${'Aero Ergonomic Office Chair'}, ${'AERO-CHAIR-003'}, ${'Premium mesh ergonomic chair with 3D armrests and lumbar support.'}, ${now}, ${now})
    `;

    console.log('[API Seed] Seeding Warehouses...');
    const wEastId = crypto.randomUUID();
    const wWestId = crypto.randomUUID();
    const wCentralId = crypto.randomUUID();

    await sql`
      INSERT INTO "Warehouse" (id, name, location, "createdAt", "updatedAt")
      VALUES (${wEastId}, ${'East Coast Fulfillment Center'}, ${'New York, NY'}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO "Warehouse" (id, name, location, "createdAt", "updatedAt")
      VALUES (${wWestId}, ${'West Coast Logistics Hub'}, ${'Los Angeles, CA'}, ${now}, ${now})
    `;
    await sql`
      INSERT INTO "Warehouse" (id, name, location, "createdAt", "updatedAt")
      VALUES (${wCentralId}, ${'Midwest Distribution Center'}, ${'Chicago, IL'}, ${now}, ${now})
    `;

    console.log('[API Seed] Seeding Inventory Stock breakdowns...');
    // Vortex Headphones: East: 15, West: 8, Central: 0 (out of stock)
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p1Id}, ${wEastId}, ${15}, ${0}, ${now})`;
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p1Id}, ${wWestId}, ${8}, ${0}, ${now})`;
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p1Id}, ${wCentralId}, ${0}, ${0}, ${now})`;

    // Apex Keyboard: East: 5, West: 12, Central: 20
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p2Id}, ${wEastId}, ${5}, ${0}, ${now})`;
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p2Id}, ${wWestId}, ${12}, ${0}, ${now})`;
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p2Id}, ${wCentralId}, ${20}, ${0}, ${now})`;

    // Aero Chair: East: 2 (low!), West: 0, Central: 1
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p3Id}, ${wEastId}, ${2}, ${0}, ${now})`;
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p3Id}, ${wWestId}, ${0}, ${0}, ${now})`;
    await sql`INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES (${crypto.randomUUID()}, ${p3Id}, ${wCentralId}, ${1}, ${0}, ${now})`;

    console.log('[API Seed] Database seeding completed successfully!');
    return NextResponse.json({ success: true, message: 'Database successfully seeded.' }, { status: 201 });
  } catch (error: any) {
    console.error('[API Seed] Seeding Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
