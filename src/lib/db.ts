import { PrismaClient } from '../generated/prisma';
import { PrismaNeon } from '@prisma/adapter-neon';

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  // PrismaNeon takes a PoolConfig object (connectionString as string).
  // It internally creates a @neondatabase/serverless Pool using WebSocket transport,
  // which works on Vercel Serverless Functions without native TCP sockets.
  // Fully compatible with Supabase via the pooler endpoint (port 6543).
  const adapter = new PrismaNeon({ connectionString: process.env.DATABASE_URL! });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  });
}

export const prisma =
  globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
