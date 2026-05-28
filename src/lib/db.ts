import postgres from 'postgres';

// Provide a fallback for build time when environment variables might not be fully loaded
const connectionString = process.env.DATABASE_URL || '';

// Create a Postgres client. 
// Using max: 1 is recommended for serverless environments to prevent connection exhaustion.
export const sql = postgres(connectionString, {
  max: 1, // Max number of connections per function instance
  idle_timeout: 20, // Idle connection timeout in seconds
  max_lifetime: 60 * 5, // Max connection lifetime in seconds
});
