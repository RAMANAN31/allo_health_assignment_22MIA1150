import { Pool } from '@neondatabase/serverless';

const globalForPool = globalThis as unknown as {
  pool: Pool | undefined;
};

function createPool() {
  return new Pool({
    connectionString: process.env.DATABASE_URL,
  });
}

export const pool = globalForPool.pool ?? createPool();

if (process.env.NODE_ENV !== 'production') globalForPool.pool = pool;
