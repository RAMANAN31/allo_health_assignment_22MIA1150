import { neon } from '@neondatabase/serverless';

// Create a stateless HTTP-based SQL client.
// Each call is an independent HTTPS request — perfect for Vercel Serverless Functions.
// No WebSocket setup, no connection pooling, no teardown required.
export const sql = neon(process.env.DATABASE_URL!);
