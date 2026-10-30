import sharp from 'sharp';
import { one } from '../db.js';

export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
export const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/avif'];

/**
 * Resizes an uploaded image to a large and a small WebP and stores both in the database.
 * Images live in Postgres so they survive redeploys (a deployment's disk is wiped each time).
 */
export async function storeImage(buffer) {
  const base = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await base.metadata();
  if (!meta.width || !meta.height) throw new Error('That file isn’t an image we can read.');
  const large = await base.clone().resize({ width: 1800, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer({ resolveWithObject: true });
  const small = await base.clone().resize({ width: 760, withoutEnlargement: true }).webp({ quality: 74 }).toBuffer();
  const row = await one(
    'INSERT INTO media (mime, width, height, data, data_small) VALUES ($1, $2, $3, $4, $5) RETURNING id',
    ['image/webp', large.info.width, large.info.height, large.data, small],
  );
  return row.id;
}

export async function getImage(id, size) {
  const col = size === 'sm' ? 'COALESCE(data_small, data)' : 'data';
  return one(`SELECT mime, ${col} AS data FROM media WHERE id = $1`, [id]);
}
