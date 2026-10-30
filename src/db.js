import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

if (!config.databaseUrl) {
  console.error('\nDATABASE_URL is not set.\nOn Replit: open the Database tool and create a PostgreSQL database; Replit adds DATABASE_URL for you.\n');
  process.exit(1);
}

const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(config.databaseUrl);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: local || /sslmode=/.test(config.databaseUrl) ? undefined : { rejectUnauthorized: false },
  max: 6,
});

pool.on('error', (err) => console.error('[db] idle client error', err.message));

export const query = (text, params) => pool.query(text, params);

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] || null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

export async function migrate() {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const sql = fs.readFileSync(path.join(dir, 'schema.sql'), 'utf8');
  await pool.query(sql);
}
