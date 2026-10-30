import { many, one, query } from '../db.js';
import { GENRES, WATCH_OPTIONS, slugify } from './util.js';

const LIVE = `status = 'published' AND published_at <= now()`;
const CARD_COLUMNS = `id, slug, title, release_year, rating, excerpt, image_id, image_alt, genres, watch_where, published_at, promoted`;

export const PAGE_SIZE = 12;

export async function latestForHome(limit = 3) {
  // the promoted review takes the first slot, then the newest
  return many(
    `SELECT ${CARD_COLUMNS} FROM reviews WHERE ${LIVE}
     ORDER BY promoted DESC, published_at DESC LIMIT $1`,
    [limit],
  );
}

export async function promotedReview() {
  return one(`SELECT ${CARD_COLUMNS} FROM reviews WHERE ${LIVE} AND promoted LIMIT 1`);
}

/** Reads the filter query string into a clean, safe object. */
export function parseFilters(q) {
  const f = {};
  const text = typeof q.q === 'string' ? q.q.trim().slice(0, 80) : '';
  if (text) f.q = text;
  if (GENRES.includes(q.genre)) f.genre = q.genre;
  const rating = Number(q.rating);
  if ([1, 2, 3, 4, 5].includes(rating)) f.rating = rating;
  const year = Number(q.year);
  if (Number.isInteger(year) && year > 1880 && year < 2100) f.year = year;
  if (q.watch in WATCH_OPTIONS) f.watch = q.watch;
  if (q.sort === 'rating') f.sort = 'rating';
  const page = Number(q.page);
  f.page = Number.isInteger(page) && page > 1 ? Math.min(page, 500) : 1;
  return f;
}

export async function listReviews(f) {
  const where = [LIVE];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
  if (f.q) add(`(title ILIKE ? OR director ILIKE $${params.length + 1})`, `%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
  if (f.genre) add('? = ANY(genres)', f.genre);
  if (f.rating) add('rating >= ?', f.rating);
  if (f.year) add('release_year = ?', f.year);
  if (f.watch === 'cinema' || f.watch === 'streaming') add(`watch_where IN (?, 'both')`, f.watch);
  else if (f.watch) add('watch_where = ?', f.watch);

  const filtered = Boolean(f.q || f.genre || f.rating || f.year || f.watch || f.sort);
  const order = f.sort === 'rating' ? 'rating DESC, published_at DESC' : 'published_at DESC';
  // pin the promoted review on the unfiltered list
  const orderBy = filtered ? order : `promoted DESC, ${order}`;

  const whereSql = where.join(' AND ');
  const total = Number((await one(`SELECT count(*) FROM reviews WHERE ${whereSql}`, params)).count);
  const rows = await many(
    `SELECT ${CARD_COLUMNS} FROM reviews WHERE ${whereSql} ORDER BY ${orderBy} LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`,
    params,
  );
  return { rows, total, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), filtered };
}

/** Values that actually have reviews, so filters never lead to an empty page. */
export async function filterOptions() {
  const genres = await many(`SELECT DISTINCT unnest(genres) AS g FROM reviews WHERE ${LIVE}`);
  const years = await many(`SELECT DISTINCT release_year AS y FROM reviews WHERE ${LIVE} AND release_year IS NOT NULL ORDER BY y DESC`);
  const used = new Set(genres.map((r) => r.g));
  return { genres: GENRES.filter((g) => used.has(g)), years: years.map((r) => r.y) };
}

export async function liveBySlug(slug) {
  return one(`SELECT * FROM reviews WHERE slug = $1 AND ${LIVE}`, [slug]);
}

export async function moreReviews(excludeId, genres, limit = 3) {
  return many(
    `SELECT ${CARD_COLUMNS} FROM reviews WHERE ${LIVE} AND id <> $1
     ORDER BY (genres && $2::text[]) DESC, published_at DESC LIMIT $3`,
    [excludeId, genres || [], limit],
  );
}

export async function allLiveForSitemap() {
  return many(`SELECT slug, updated_at, published_at FROM reviews WHERE ${LIVE} ORDER BY published_at DESC`);
}

export async function feedReviews(limit = 30) {
  return many(`SELECT ${CARD_COLUMNS} FROM reviews WHERE ${LIVE} ORDER BY published_at DESC LIMIT $1`, [limit]);
}

/** Reviews published since a moment, for the weekly email. */
export async function publishedSince(since) {
  return many(`SELECT ${CARD_COLUMNS} FROM reviews WHERE ${LIVE} AND published_at > $1 ORDER BY published_at DESC`, [since]);
}

/* ---------- owner ---------- */

export async function adminList(status) {
  const where = status === 'draft' ? `status = 'draft'`
    : status === 'scheduled' ? `status = 'published' AND published_at > now()`
    : status === 'published' ? LIVE
    : 'true';
  return many(
    `SELECT id, slug, title, rating, status, published_at, promoted, updated_at, image_id,
            (status = 'published' AND published_at > now()) AS scheduled
     FROM reviews WHERE ${where}
     ORDER BY COALESCE(published_at, updated_at) DESC`,
  );
}

export async function adminCounts() {
  return one(
    `SELECT count(*) FILTER (WHERE ${LIVE})::int AS published,
            count(*) FILTER (WHERE status = 'published' AND published_at > now())::int AS scheduled,
            count(*) FILTER (WHERE status = 'draft')::int AS draft,
            count(*)::int AS total
     FROM reviews`,
  );
}

export const byId = (id) => one('SELECT * FROM reviews WHERE id = $1', [id]);

export async function uniqueSlug(title, exceptId = 0) {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; await one('SELECT 1 FROM reviews WHERE slug = $1 AND id <> $2', [slug, exceptId]); n++) slug = `${base}-${n}`;
  return slug;
}

const FIELDS = ['slug', 'title', 'release_year', 'director', 'certificate', 'runtime_minutes', 'genres', 'rating', 'excerpt', 'body_html',
  'image_id', 'image_alt', 'image_credit', 'trailer_url', 'watch_where', 'watch_detail', 'has_spoilers', 'status', 'published_at', 'promoted'];

export async function saveReview(id, data) {
  const cols = FIELDS.filter((k) => k in data);
  const values = cols.map((k) => data[k]);
  if (data.promoted) await query('UPDATE reviews SET promoted = false WHERE promoted AND id <> $1', [id || 0]);
  if (id) {
    const set = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    await query(`UPDATE reviews SET ${set}, updated_at = now() WHERE id = $${cols.length + 1}`, [...values, id]);
    return id;
  }
  const row = await one(
    `INSERT INTO reviews (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    values,
  );
  return row.id;
}

export async function setPromoted(id, promoted) {
  if (promoted) await query('UPDATE reviews SET promoted = false WHERE promoted AND id <> $1', [id]);
  await query('UPDATE reviews SET promoted = $2, updated_at = now() WHERE id = $1', [id, promoted]);
}

export async function deleteReview(id) {
  const row = await one('DELETE FROM reviews WHERE id = $1 RETURNING image_id', [id]);
  if (row?.image_id) await deleteMediaIfUnused(row.image_id);
}

export async function deleteMediaIfUnused(mediaId) {
  await query('DELETE FROM media WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM reviews WHERE image_id = $1)', [mediaId]);
}
