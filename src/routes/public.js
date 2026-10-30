import { Router } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { config } from '../config.js';
import { one } from '../db.js';
import { getImage } from '../lib/media.js';
import * as nl from '../lib/newsletter.js';
import * as reviews from '../lib/reviews.js';
import { getSettings } from '../lib/settings.js';
import { looksLikeSpam } from '../lib/spam.js';
import { escapeHtml, isEmail, stripHtml, trailerEmbed, WATCH_OPTIONS } from '../lib/util.js';
import sharp from 'sharp';

const router = Router();
export default router;

// Behind Replit's proxies the visitor's address is the first one in X-Forwarded-For.
// It can be faked, but that only weakens the limit for that person rather than
// risking every visitor sharing one limit.
const visitorKey = (req) => ipKeyGenerator((req.get('x-forwarded-for') || '').split(',')[0].trim() || req.ip || 'unknown');

const limiter = (max, minutes) => rateLimit({
  windowMs: minutes * 60 * 1000, limit: max, standardHeaders: 'draft-8', legacyHeaders: false,
  keyGenerator: visitorKey, validate: { trustProxy: false, xForwardedForHeader: false, keyGeneratorIpFallback: false },
  handler: (req, res) => res.status(429).render('pages/message', {
    title: 'Too many attempts', heading: 'Too many attempts',
    text: 'You’ve sent this form a lot in a short time. Wait a little while, then try again.',
  }),
});

/* ---------- pages ---------- */

router.get('/', async (req, res) => {
  const [latest, featured] = await Promise.all([reviews.latestForHome(3), reviews.promotedReview()]);
  res.render('pages/home', {
    latest, featured,
    newsletterStatus: req.query.newsletter,
    pageDescription: (await getSettings()).site.description,
  });
});

router.get('/reviews', async (req, res) => {
  const filters = reviews.parseFilters(req.query);
  const [result, options] = await Promise.all([reviews.listReviews(filters), reviews.filterOptions()]);
  if (filters.page > result.pages && result.total) return res.redirect(pageUrl(filters, result.pages));
  res.render('pages/reviews', {
    title: filters.page > 1 ? `Reviews, page ${filters.page}` : 'Reviews',
    filters, result, options, pageUrl: (p) => pageUrl(filters, p),
    pageDescription: 'Every Films on Cue review, newest first. Filter by genre, rating, year and where to watch.',
  });
});

function pageUrl(filters, page) {
  const p = new URLSearchParams();
  for (const k of ['q', 'genre', 'rating', 'year', 'watch', 'sort']) if (filters[k]) p.set(k, filters[k]);
  if (page > 1) p.set('page', page);
  const s = p.toString();
  return `/reviews${s ? `?${s}` : ''}`;
}

router.get('/reviews/:slug', async (req, res, next) => {
  const review = await reviews.liveBySlug(req.params.slug);
  if (!review) return next();
  const more = await reviews.moreReviews(review.id, review.genres);
  res.render('pages/review', {
    title: `${review.title}${review.release_year ? ` (${review.release_year})` : ''} review`,
    review, more,
    trailer: trailerEmbed(review.trailer_url),
    watchLabel: WATCH_OPTIONS[review.watch_where],
    pageDescription: review.excerpt || stripHtml(review.body_html).slice(0, 160),
    ogImage: review.image_id ? `${config.siteUrl}/media/${review.image_id}.jpg` : null,
    ogType: 'article',
    newsletterStatus: req.query.newsletter,
  });
});

router.get('/about', async (req, res) => {
  const s = await getSettings();
  res.render('pages/about', { title: 'About', pageDescription: s.about.intro });
});

router.get('/contact', async (req, res) => {
  res.render('pages/contact', { title: 'Contact', sent: req.query.sent === '1', errors: {}, values: {} });
});

router.post('/contact', limiter(6, 60), async (req, res) => {
  const b = req.body || {};
  const values = {
    name: String(b.name || '').trim().slice(0, 120),
    phone: String(b.phone || '').trim().slice(0, 40),
    email: String(b.email || '').trim().slice(0, 254),
    message: String(b.message || '').trim().slice(0, 5000),
  };
  const errors = {};
  if (!values.name) errors.name = 'Enter your name.';
  if (!isEmail(values.email)) errors.email = 'Enter an email address like name@example.com.';
  if (values.phone && !/^[+()\d\s.-]{6,40}$/.test(values.phone)) errors.phone = 'Enter a phone number using digits, spaces and + only.';
  if (values.message.length < 5) errors.message = 'Enter your message.';
  if (Object.keys(errors).length) return res.status(422).render('pages/contact', { title: 'Contact', sent: false, errors, values });

  if (!(await looksLikeSpam(req))) {
    const msg = await one(
      'INSERT INTO messages (name, phone, email, message) VALUES ($1, $2, $3, $4) RETURNING *',
      [values.name, values.phone || null, values.email, values.message],
    );
    nl.notifyOwnerOfMessage(msg).catch((err) => console.error('[contact] notify failed:', err.message));
  }
  res.redirect(303, '/contact?sent=1#contact-form');
});

router.get('/privacy', (req, res) => res.render('pages/privacy', { title: 'Privacy policy' }));

/* ---------- newsletter ---------- */

router.post('/newsletter', limiter(10, 60), async (req, res) => {
  const back = safeBack(req.body.back);
  const email = String(req.body.email || '').trim();
  let status;
  if (!isEmail(email)) status = 'invalid';
  else if (req.body.consent !== 'yes') status = 'consent';
  else if (await looksLikeSpam(req)) status = 'check-email';
  else status = await nl.subscribe(email);
  res.redirect(303, `${back}${back.includes('?') ? '&' : '?'}newsletter=${status}#newsletter`);
});

function safeBack(path) {
  return typeof path === 'string' && /^\/(reviews\/[\w-]+)?$/.test(path) ? path : '/';
}

router.get('/newsletter/confirm/:token', async (req, res) => {
  const sub = await nl.confirm(req.params.token);
  res.render('pages/message', sub
    ? { title: 'Subscribed', heading: 'You’re subscribed', text: `We’ll send the weekly email to ${sub.email}. Every email has a link to unsubscribe.`, link: { href: '/reviews', label: 'Read the latest reviews' } }
    : { title: 'Link expired', heading: 'This link has expired', text: 'Sign up again from the home page and we’ll send a new confirmation email.', link: { href: '/#newsletter', label: 'Go to sign-up' } });
});

router.get('/newsletter/unsubscribe/:token', async (req, res) => {
  const sub = await nl.findByToken(req.params.token);
  res.render('pages/unsubscribe', { title: 'Unsubscribe', sub, token: req.params.token, done: false });
});

// also used by email apps' one-click "Unsubscribe" button (RFC 8058), so no origin check
router.post('/newsletter/unsubscribe/:token', async (req, res) => {
  const sub = await nl.unsubscribe(req.params.token);
  if (req.body?.['List-Unsubscribe'] === 'One-Click') return res.status(200).send('Unsubscribed');
  res.render('pages/unsubscribe', { title: 'Unsubscribed', sub, token: req.params.token, done: true });
});

/* ---------- images ---------- */

router.get('/media/:file', async (req, res, next) => {
  const m = /^(\d+)(\.(webp|jpg))?$/.exec(req.params.file);
  if (!m) return next();
  const img = await getImage(Number(m[1]), req.query.s);
  if (!img) return next();
  res.set('Cache-Control', 'public, max-age=31536000, immutable');
  if (m[3] === 'jpg') {
    // JPEG copies for email apps and social previews that can't show WebP
    res.type('image/jpeg').send(await sharp(img.data).flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer());
  } else {
    res.type(img.mime).send(img.data);
  }
});

/* ---------- feeds and search engines ---------- */

router.get('/robots.txt', (req, res) => {
  res.type('text/plain').send(`User-agent: *\nDisallow: /admin\nDisallow: /login\nDisallow: /newsletter/\nSitemap: ${config.siteUrl}/sitemap.xml\n`);
});

router.get('/sitemap.xml', async (req, res) => {
  const rows = await reviews.allLiveForSitemap();
  const urls = ['/', '/reviews', '/about', '/contact', '/privacy'].map((p) => `<url><loc>${config.siteUrl}${p}</loc></url>`)
    .concat(rows.map((r) => `<url><loc>${config.siteUrl}/reviews/${r.slug}</loc><lastmod>${new Date(r.updated_at).toISOString()}</lastmod></url>`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`);
});

router.get('/feed.xml', async (req, res) => {
  const s = await getSettings();
  const rows = await reviews.feedReviews();
  const items = rows.map((r) => `<item><title>${escapeHtml(r.title)}</title><link>${config.siteUrl}/reviews/${r.slug}</link><guid>${config.siteUrl}/reviews/${r.slug}</guid><pubDate>${new Date(r.published_at).toUTCString()}</pubDate><description>${escapeHtml(r.excerpt)}</description></item>`).join('');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>${escapeHtml(s.site.name)}</title><link>${config.siteUrl}</link><description>${escapeHtml(s.site.description)}</description><language>en-gb</language>${items}</channel></rss>`);
});

/* ---------- scheduled weekly email over HTTP (optional) ---------- */

router.post('/cron/digest', async (req, res) => {
  if (!config.cronSecret || req.get('authorization') !== `Bearer ${config.cronSecret}`) return res.status(404).end();
  const settings = await getSettings();
  const result = (await nl.digestIsDue(settings)) ? await nl.sendWeeklyDigest() : { status: 'not-due' };
  res.json(result);
});
