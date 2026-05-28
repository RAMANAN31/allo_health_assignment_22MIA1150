import { NextResponse } from 'next/server';
import { pool } from '@/lib/db';
import crypto from 'crypto';

export async function POST() {
  try {
    console.log('[API Seed] Clearing database tables...');
    
    // Clean in correct dependency order
    await pool.query('DELETE FROM "IdempotencyRecord"');
    await pool.query('DELETE FROM "Reservation"');
    await pool.query('DELETE FROM "Inventory"');
    await pool.query('DELETE FROM "Warehouse"');
    await pool.query('DELETE FROM "Product"');

    console.log('[API Seed] Seeding Products...');
    const p1Id = crypto.randomUUID();
    const p2Id = crypto.randomUUID();
    const p3Id = crypto.randomUUID();
    const now = new Date();

    await pool.query(
      'INSERT INTO "Product" (id, name, sku, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $5)',
      [
        p1Id,
        'Vortex Pro Wireless Headphones',
        'VORTEX-PRO-001',
        'Noise-cancelling high-fidelity wireless over-ear headphones with 40-hour battery life.',
        now
      ]
    );

    await pool.query(
      'INSERT INTO "Product" (id, name, sku, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $5)',
      [
        p2Id,
        'Apex Mechanical Keyboard',
        'APEX-MECH-002',
        'Hot-swappable mechanical keyboard with custom linear switches and RGB backlighting.',
        now
      ]
    );

    await pool.query(
      'INSERT INTO "Product" (id, name, sku, description, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $5, $5)',
      [
        p3Id,
        'Aero Ergonomic Office Chair',
        'AERO-CHAIR-003',
        'Premium mesh ergonomic chair with 3D armrests and lumbar support.',
        now
      ]
    );

    console.log('[API Seed] Seeding Warehouses...');
    const wEastId = crypto.randomUUID();
    const wWestId = crypto.randomUUID();
    const wCentralId = crypto.randomUUID();

    await pool.query(
      'INSERT INTO "Warehouse" (id, name, location, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)',
      [wEastId, 'East Coast Fulfillment Center', 'New York, NY', now]
    );

    await pool.query(
      'INSERT INTO "Warehouse" (id, name, location, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)',
      [wWestId, 'West Coast Logistics Hub', 'Los Angeles, CA', now]
    );

    await pool.query(
      'INSERT INTO "Warehouse" (id, name, location, "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, $4)',
      [wCentralId, 'Midwest Distribution Center', 'Chicago, IL', now]
    );

    console.log('[API Seed] Seeding Inventory Stock breakdowns...');
    // Vortex Headphones:
    // East: 15 units
    // West: 8 units
    // Central: 0 units (out of stock)
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p1Id, wEastId, 15, 0, now]
    );
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p1Id, wWestId, 8, 0, now]
    );
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p1Id, wCentralId, 0, 0, now]
    );

    // Apex Keyboard:
    // East: 5 units
    // West: 12 units
    // Central: 20 units
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p2Id, wEastId, 5, 0, now]
    );
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p2Id, wWestId, 12, 0, now]
    );
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p2Id, wCentralId, 20, 0, now]
    );

    // Aero Chair:
    // East: 2 units (low stock!)
    // West: 0 units
    // Central: 1 units
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p3Id, wEastId, 2, 0, now]
    );
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p3Id, wWestId, 0, 0, now]
    );
    await pool.query(
      'INSERT INTO "Inventory" (id, "productId", "warehouseId", "totalUnits", "reservedUnits", "updatedAt") VALUES ($1, $2, $3, $4, $5, $6)',
      [crypto.randomUUID(), p3Id, wCentralId, 1, 0, now]
    );

    console.log('[API Seed] Database seeding completed successfully!');
    return NextResponse.json({ success: true, message: 'Database successfully seeded.' }, { status: 201 });
  } catch (error: any) {
    console.error('[API Seed] Seeding Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
