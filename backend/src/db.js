import dotenv from 'dotenv';
import pg from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '..', 'config', '.env') });

// Force bypass for Vercel/Neon/Supabase self-signed certs
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});

export async function query(text, params) {
  return pool.query(text, params);
}

