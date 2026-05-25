import { PrismaClient } from '@prisma/client';
import { PrismaNeon } from '@prisma/adapter-neon';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // PrismaNeon uses @neondatabase/serverless Pool with WebSocket transport.
  // Works on Vercel Serverless Functions — no native TCP sockets needed.
  // Fully compatible with Supabase PostgreSQL via the pooler endpoint (port 6543).
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
