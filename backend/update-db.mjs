import { query } from './src/db.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, 'config', '.env') });

async function updateDb() {
  try {
    const schema = fs.readFileSync(path.join(__dirname, 'sql', 'schema.sql'), 'utf-8');
    await query(schema);
    console.log('DB Schema applied successfully');
  } catch (error) {
    console.error(error);
  } finally {
    process.exit(0);
  }
}

updateDb();
