import postgres from 'postgres';

const sql = postgres({
  host: 'aws-0-ap-south-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  username: 'postgres.jbjdsevvfarxxlegttxr',
  password: 'Allrounder@2004@',
  ssl: 'require',
});

async function setup() {
  try {
    console.log('Creating tables...');

    await sql`
      CREATE TABLE IF NOT EXISTS "Product" (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        sku VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "Warehouse" (
        id UUID PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        location VARCHAR(255) NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "Inventory" (
        id UUID PRIMARY KEY,
        "productId" UUID NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
        "warehouseId" UUID NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
        "totalUnits" INTEGER NOT NULL DEFAULT 0,
        "reservedUnits" INTEGER NOT NULL DEFAULT 0,
        "updatedAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE("productId", "warehouseId")
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "Reservation" (
        id UUID PRIMARY KEY,
        "productId" UUID NOT NULL REFERENCES "Product"(id) ON DELETE CASCADE,
        "warehouseId" UUID NOT NULL REFERENCES "Warehouse"(id) ON DELETE CASCADE,
        quantity INTEGER NOT NULL,
        status VARCHAR(50) NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        "confirmedAt" TIMESTAMP WITH TIME ZONE,
        "releasedAt" TIMESTAMP WITH TIME ZONE,
        "idempotencyKey" VARCHAR(255)
      );
    `;

    await sql`
      CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
        key VARCHAR(255) PRIMARY KEY,
        "responseBody" TEXT NOT NULL,
        "statusCode" INTEGER NOT NULL,
        "expiresAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('Tables created successfully!');
  } catch (error) {
    console.error('Error creating tables:', error);
  } finally {
    process.exit(0);
  }
}

setup();
