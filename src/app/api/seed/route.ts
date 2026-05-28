import { NextResponse } from 'next/server';
import { supabase } from '@/lib/db';
import crypto from 'crypto';

export async function POST() {
  try {
    console.log('[API Seed] Clearing database tables...');
    
    // Clean in correct dependency order
    await supabase.from('IdempotencyRecord').delete().neq('key', 'dummy');
    await supabase.from('Reservation').delete().neq('id', 'dummy');
    await supabase.from('Inventory').delete().neq('id', 'dummy');
    await supabase.from('Warehouse').delete().neq('id', 'dummy');
    await supabase.from('Product').delete().neq('id', 'dummy');

    console.log('[API Seed] Seeding Products...');
    const p1Id = crypto.randomUUID();
    const p2Id = crypto.randomUUID();
    const p3Id = crypto.randomUUID();
    const now = new Date().toISOString();

    const products = [
      { id: p1Id, name: 'Vortex Pro Wireless Headphones', sku: 'VORTEX-PRO-001', description: 'Noise-cancelling high-fidelity wireless over-ear headphones with 40-hour battery life.', createdAt: now, updatedAt: now },
      { id: p2Id, name: 'Apex Mechanical Keyboard', sku: 'APEX-MECH-002', description: 'Hot-swappable mechanical keyboard with custom linear switches and RGB backlighting.', createdAt: now, updatedAt: now },
      { id: p3Id, name: 'Aero Ergonomic Office Chair', sku: 'AERO-CHAIR-003', description: 'Premium mesh ergonomic chair with 3D armrests and lumbar support.', createdAt: now, updatedAt: now }
    ];

    await supabase.from('Product').insert(products);

    console.log('[API Seed] Seeding Warehouses...');
    const wEastId = crypto.randomUUID();
    const wWestId = crypto.randomUUID();
    const wCentralId = crypto.randomUUID();

    const warehouses = [
      { id: wEastId, name: 'East Coast Fulfillment Center', location: 'New York, NY', createdAt: now, updatedAt: now },
      { id: wWestId, name: 'West Coast Logistics Hub', location: 'Los Angeles, CA', createdAt: now, updatedAt: now },
      { id: wCentralId, name: 'Midwest Distribution Center', location: 'Chicago, IL', createdAt: now, updatedAt: now }
    ];

    await supabase.from('Warehouse').insert(warehouses);

    console.log('[API Seed] Seeding Inventory Stock breakdowns...');
    const inventory = [
      // Vortex Headphones
      { id: crypto.randomUUID(), productId: p1Id, warehouseId: wEastId, totalUnits: 15, reservedUnits: 0, updatedAt: now },
      { id: crypto.randomUUID(), productId: p1Id, warehouseId: wWestId, totalUnits: 8, reservedUnits: 0, updatedAt: now },
      { id: crypto.randomUUID(), productId: p1Id, warehouseId: wCentralId, totalUnits: 0, reservedUnits: 0, updatedAt: now },
      // Apex Keyboard
      { id: crypto.randomUUID(), productId: p2Id, warehouseId: wEastId, totalUnits: 5, reservedUnits: 0, updatedAt: now },
      { id: crypto.randomUUID(), productId: p2Id, warehouseId: wWestId, totalUnits: 12, reservedUnits: 0, updatedAt: now },
      { id: crypto.randomUUID(), productId: p2Id, warehouseId: wCentralId, totalUnits: 20, reservedUnits: 0, updatedAt: now },
      // Aero Chair
      { id: crypto.randomUUID(), productId: p3Id, warehouseId: wEastId, totalUnits: 2, reservedUnits: 0, updatedAt: now },
      { id: crypto.randomUUID(), productId: p3Id, warehouseId: wWestId, totalUnits: 0, reservedUnits: 0, updatedAt: now },
      { id: crypto.randomUUID(), productId: p3Id, warehouseId: wCentralId, totalUnits: 1, reservedUnits: 0, updatedAt: now }
    ];

    await supabase.from('Inventory').insert(inventory);

    console.log('[API Seed] Database seeding completed successfully!');
    return NextResponse.json({ success: true, message: 'Database successfully seeded.' }, { status: 201 });
  } catch (error: any) {
    console.error('[API Seed] Seeding Error:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
