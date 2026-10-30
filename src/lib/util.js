import crypto from 'node:crypto';

export const GENRES = [
  'Action', 'Adventure', 'Animation', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family',
  'Fantasy', 'Horror', 'Musical', 'Mystery', 'Romance', 'Sci-fi', 'Thriller', 'War', 'Western',
];

export const CERTIFICATES = ['U', 'PG', '12A', '12', '15', '18'];

export const WATCH_OPTIONS = {
  cinema: 'In cinemas',
  streaming: 'Streaming',
  both: 'In cinemas and streaming',
  rent: 'To rent or buy',
};

export const RATINGS = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

export function slugify(text) {
  return String(text)
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'review';
}

export const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function stripHtml(html) {
  return String(html || '')
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/blockquote)[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function truncate(text, max) {
  if (!text || text.length <= max) return text || '';
  const cut = text.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > max * 0.6 ? cut.lastIndexOf(' ') : max).replace(/[,.;:\s]+$/, '') + '…';
}

export const isEmail = (s) => typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);

/* ---------- dates, always in UK time ---------- */
const TZ = 'Europe/London';
const longDate = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'long', year: 'numeric' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const formatDate = (d) => (d ? longDate.format(new Date(d)) : '');
export const formatShortDate = (d) => (d ? shortDate.format(new Date(d)) : '');
export const formatDateTime = (d) => (d ? dateTime.format(new Date(d)) : '');

function londonParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(date);
  const o = {};
  for (const p of parts) o[p.type] = p.value;
  return o;
}

/** Date -> "YYYY-MM-DDTHH:mm" in UK time, for <input type="datetime-local">. */
export function toLondonInput(d) {
  if (!d) return '';
  const p = londonParts(new Date(d));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}

/** "YYYY-MM-DDTHH:mm" entered in UK time -> Date. */
export function fromLondonInput(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value || '');
  if (!m) return null;
  const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  // find London's offset at that moment and correct for it
  const p = londonParts(new Date(asUtc));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(asUtc - (shown - asUtc));
}

/** Day of week (0 = Sunday) and hour in UK time. */
export function londonNow(date = new Date()) {
  const p = londonParts(date);
  const day = new Date(Date.UTC(+p.year, +p.month - 1, +p.day)).getUTCDay();
  return { day, hour: +p.hour, year: +p.year, month: +p.month, date: +p.day };
}

/** ISO week key like "2026-W44", in UK time. */
export function weekKey(date = new Date()) {
  const n = londonNow(date);
  const d = new Date(Date.UTC(n.year, n.month - 1, n.date));
  const dow = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dow);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

/* ---------- ratings ---------- */
const STAR = 'M12 2.6l2.83 6.13 6.7.73-5 4.53 1.4 6.6L12 17.2l-5.93 3.4 1.4-6.6-5-4.53 6.7-.73z';

/** Five stars as inline SVG, with half stars, and a label for screen readers. */
export function starsHtml(rating, { size = 18 } = {}) {
  const r = Number(rating) || 0;
  let out = `<span class="stars" role="img" aria-label="Rated ${formatRating(r)} out of 5" style="--star:${size}px">`;
  for (let i = 1; i <= 5; i++) {
    const fill = r >= i ? 'full' : r >= i - 0.5 ? 'half' : 'empty';
    out += `<svg viewBox="0 0 24 24" class="star star-${fill}" aria-hidden="true">`;
    if (fill === 'half') out += `<defs><clipPath id="h${i}${size}"><rect width="12" height="24"/></clipPath></defs><path d="${STAR}" class="star-outline"/><path d="${STAR}" clip-path="url(#h${i}${size})" class="star-fill"/>`;
    else out += `<path d="${STAR}" class="${fill === 'full' ? 'star-fill' : 'star-outline'}"/>`;
    out += '</svg>';
  }
  return out + '</span>';
}

export const formatRating = (r) => {
  const n = Number(r);
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
};

/** Text stars for emails: ★★★★½ */
export function starsText(rating) {
  const r = Number(rating);
  return '★'.repeat(Math.floor(r)) + (r % 1 ? '½' : '') + '☆'.repeat(5 - Math.ceil(r));
}

/* ---------- trailers ---------- */
export function trailerEmbed(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\.|^m\./, '');
    let id;
    if (host === 'youtu.be') id = u.pathname.slice(1);
    else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
      id = u.searchParams.get('v') || (u.pathname.match(/^\/(embed|shorts|live)\/([\w-]+)/) || [])[2];
    }
    if (id && /^[\w-]{6,20}$/.test(id)) return `https://www.youtube-nocookie.com/embed/${id}?rel=0`;
    if (host === 'vimeo.com' || host === 'player.vimeo.com') {
      const v = (u.pathname.match(/(\d{5,})/) || [])[1];
      if (v) return `https://player.vimeo.com/video/${v}?dnt=1`;
    }
  } catch { /* not a URL */ }
  return null;
}

export function csvCell(v) {
  const s = v == null ? '' : String(v);
  // stop spreadsheet apps treating values as formulas
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const hourLabel = (h) => `${String(h).padStart(2, '0')}:00`;
