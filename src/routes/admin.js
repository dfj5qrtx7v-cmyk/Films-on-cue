import { Router } from 'express';
import multer from 'multer';
import { checkCsrf, requireOwner } from '../auth.js';
import { emailEnabled } from '../config.js';
import { many, one, query } from '../db.js';
import { ACCEPTED_TYPES, MAX_UPLOAD_BYTES, storeImage } from '../lib/media.js';
import * as nl from '../lib/newsletter.js';
import * as reviews from '../lib/reviews.js';
import { cleanRichText } from '../lib/sanitize.js';
import { DEFAULTS, getSettings, saveSetting, SOCIAL_PLATFORMS } from '../lib/settings.js';
import {
  CERTIFICATES, csvCell, fromLondonInput, GENRES, isEmail, RATINGS, stripHtml, toLondonInput, trailerEmbed, truncate, WATCH_OPTIONS,
  weekKey as weekKeyNow,
} from '../lib/util.js';

const router = Router();
export default router;

router.use(requireOwner);
router.use((req, res, next) => {
  res.locals.flash = req.session.flash;
  delete req.session.flash;
  res.locals.section = req.path.split('/')[1] || 'overview';
  next();
});

const flash = (req, text, type = 'ok') => { req.session.flash = { text, type }; };

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 },
  fileFilter: (req, file, cb) => cb(null, ACCEPTED_TYPES.includes(file.mimetype)),
});
// multer errors (e.g. file too big) become a form error instead of a crash
const parseUpload = (req, res, next) => upload.single('image')(req, res, (err) => {
  if (err) req.uploadError = err.code === 'LIMIT_FILE_SIZE' ? 'That image is over 12 MB. Choose a smaller file.' : 'The image couldn’t be uploaded. Try again.';
  next();
});

/* ---------- overview ---------- */

router.get('/', async (req, res) => {
  const settings = await getSettings();
  const [counts, subs, unread, pending, recent] = await Promise.all([
    reviews.adminCounts(),
    one(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'pending')::int AS pending FROM subscribers`),
    one('SELECT count(*)::int AS n FROM messages WHERE NOT is_read'),
    nl.pendingDigestReviews(),
    reviews.adminList('all'),
  ]);
  const setup = [];
  if (!emailEnabled) setup.push({ text: 'Email isn’t connected yet, so the newsletter and message alerts are paused.', href: '/admin/newsletter' });
  if (!process.env.SITE_URL && process.env.REPLIT_DEPLOYMENT) setup.push({ text: 'Add a SITE_URL secret with your site’s address so email links point to it.', href: null });
  if (!Object.values(settings.socials.items).some((s) => s.url)) setup.push({ text: 'Add your Instagram, Facebook and TikTok links.', href: '/admin/settings#socials' });
  res.render('admin/overview', {
    title: 'Overview', counts, subs, unread: unread.n, pending, recent: recent.slice(0, 5), setup, settings,
  });
});

/* ---------- reviews ---------- */

router.get('/reviews', async (req, res) => {
  const status = ['published', 'scheduled', 'draft'].includes(req.query.status) ? req.query.status : 'all';
  const [rows, counts] = await Promise.all([reviews.adminList(status), reviews.adminCounts()]);
  res.render('admin/reviews', { title: 'Reviews', rows, counts, status });
});

const blankReview = {
  title: '', release_year: '', director: '', certificate: '', runtime_minutes: '', genres: [], rating: '', excerpt: '', body_html: '',
  image_id: null, image_alt: '', image_credit: '', trailer_url: '', watch_where: '', watch_detail: '', has_spoilers: false,
  status: 'draft', published_at: null, promoted: false, slug: '',
};

function renderForm(res, review, errors = {}, status = 200) {
  res.status(status).render('admin/review-form', {
    title: review.id ? `Edit: ${review.title || 'review'}` : 'New review',
    review, errors, GENRES, CERTIFICATES, WATCH_OPTIONS, RATINGS,
    publishAtInput: review.publish_at_input ?? toLondonInput(review.published_at),
  });
}

router.get('/reviews/new', (req, res) => renderForm(res, { ...blankReview }));

router.get('/reviews/:id/edit', async (req, res, next) => {
  const review = await reviews.byId(Number(req.params.id) || 0);
  if (!review) return next();
  renderForm(res, review);
});

/** Turns the submitted form into review fields, collecting any problems. */
function readReviewForm(body, existing) {
  const errors = {};
  const int = (v, min, max) => { const n = Number(v); return v === '' || v == null ? null : Number.isInteger(n) && n >= min && n <= max ? n : NaN; };
  const text = (v, max) => String(v ?? '').trim().slice(0, max);

  const r = {
    title: text(body.title, 200),
    release_year: int(body.release_year, 1880, 2100),
    director: text(body.director, 160) || null,
    certificate: CERTIFICATES.includes(body.certificate) ? body.certificate : null,
    runtime_minutes: int(body.runtime_minutes, 1, 900),
    genres: [].concat(body.genres || []).filter((g) => GENRES.includes(g)),
    rating: Number(body.rating),
    body_html: cleanRichText(body.body_html),
    image_alt: text(body.image_alt, 200) || null,
    image_credit: text(body.image_credit, 200) || null,
    trailer_url: text(body.trailer_url, 500) || null,
    watch_where: body.watch_where in WATCH_OPTIONS ? body.watch_where : null,
    watch_detail: text(body.watch_detail, 120) || null,
    has_spoilers: body.has_spoilers === 'on',
    promoted: body.promoted === 'on',
  };
  r.excerpt = text(body.excerpt, 320) || truncate(stripHtml(r.body_html), 220);

  if (!r.title) errors.title = 'Enter the film’s title.';
  if (Number.isNaN(r.release_year)) errors.release_year = 'Enter a four-digit year, like 2026.';
  if (Number.isNaN(r.runtime_minutes)) errors.runtime_minutes = 'Enter the running time in minutes, like 118.';
  if (!RATINGS.includes(r.rating)) errors.rating = 'Choose a star rating.';
  if (r.trailer_url && !trailerEmbed(r.trailer_url)) errors.trailer_url = 'Paste a YouTube or Vimeo link.';

  const wantSlug = text(body.slug, 80);
  r.wantSlug = wantSlug;

  // publishing
  const intent = body.intent === 'publish' ? 'publish' : 'draft';
  const at = body.published_at ? fromLondonInput(body.published_at) : null;
  if (body.published_at && !at) errors.published_at = 'Enter a valid date and time.';
  r.publish_at_input = body.published_at || '';
  if (intent === 'publish') {
    r.status = 'published';
    r.published_at = at || (existing?.status === 'published' && existing.published_at) || new Date();
  } else {
    r.status = 'draft';
    r.published_at = at;
  }
  if (r.promoted && r.status !== 'published') errors.promoted = 'Only published reviews can be promoted. Publish it, or untick this.';
  if (!r.body_html && intent === 'publish') errors.body_html = 'Write the review before publishing.';
  return { r, errors };
}

async function saveFromForm(req, res, existing) {
  const { r, errors } = readReviewForm(req.body, existing);
  if (req.uploadError) errors.image = req.uploadError;
  const keepImage = existing?.image_id && req.body.remove_image !== 'on' ? existing.image_id : null;
  if (Object.keys(errors).length) {
    return renderForm(res, { ...(existing || blankReview), ...r, image_id: keepImage, slug: r.wantSlug || existing?.slug || '' }, errors, 422);
  }

  let imageId = keepImage;
  if (req.file) {
    try {
      imageId = await storeImage(req.file.buffer);
    } catch {
      return renderForm(res, { ...(existing || blankReview), ...r, image_id: keepImage }, { image: 'That file couldn’t be read as an image. Try a JPEG or PNG.' }, 422);
    }
  }
  if (imageId && !r.image_alt) r.image_alt = `Still from ${r.title}`;

  const slug = await reviews.uniqueSlug(r.wantSlug || existing?.slug || r.title, existing?.id || 0);
  const { wantSlug, publish_at_input, ...fields } = r;
  const id = await reviews.saveReview(existing?.id, { ...fields, slug, image_id: imageId });
  if (existing?.image_id && existing.image_id !== imageId) await reviews.deleteMediaIfUnused(existing.image_id);

  const scheduled = r.status === 'published' && new Date(r.published_at) > new Date();
  flash(req, r.status === 'draft' ? 'Draft saved.' : scheduled ? 'Review scheduled.' : existing?.status === 'published' ? 'Changes published.' : 'Review published.');
  res.redirect(303, `/admin/reviews/${id}/edit`);
}

router.post('/reviews', parseUpload, checkCsrf, (req, res) => saveFromForm(req, res, null));

router.post('/reviews/:id', parseUpload, checkCsrf, async (req, res, next) => {
  const existing = await reviews.byId(Number(req.params.id) || 0);
  if (!existing) return next();
  return saveFromForm(req, res, existing);
});

router.post('/reviews/:id/promote', checkCsrf, async (req, res, next) => {
  const r = await reviews.byId(Number(req.params.id) || 0);
  if (!r) return next();
  const on = req.body.promoted === 'on';
  if (on && (r.status !== 'published' || new Date(r.published_at) > new Date())) {
    flash(req, 'Only live reviews can be promoted. Publish it first.', 'error');
  } else {
    await reviews.setPromoted(r.id, on);
    flash(req, on ? `“${r.title}” is now promoted to the top of the site.` : `“${r.title}” is no longer promoted.`);
  }
  res.redirect(303, safeAdminBack(req.body.back));
});

router.get('/reviews/:id/delete', async (req, res, next) => {
  const review = await reviews.byId(Number(req.params.id) || 0);
  if (!review) return next();
  res.render('admin/confirm-delete', { title: 'Delete review', review });
});

router.post('/reviews/:id/delete', checkCsrf, async (req, res) => {
  const r = await reviews.byId(Number(req.params.id) || 0);
  if (r) {
    await reviews.deleteReview(r.id);
    flash(req, `“${r.title}” was deleted.`);
  }
  res.redirect(303, '/admin/reviews');
});

const safeAdminBack = (p) => (typeof p === 'string' && /^\/admin(\/[\w/?=&-]*)?$/.test(p) ? p : '/admin/reviews');

/* ---------- newsletter ---------- */

router.get('/newsletter', async (req, res) => {
  const settings = await getSettings();
  const filter = ['active', 'pending', 'unsubscribed'].includes(req.query.show) ? req.query.show : 'active';
  const [subs, counts, pending, digests] = await Promise.all([
    many('SELECT * FROM subscribers WHERE status = $1 ORDER BY created_at DESC LIMIT 500', [filter]),
    one(`SELECT count(*) FILTER (WHERE status = 'active')::int AS active, count(*) FILTER (WHERE status = 'pending')::int AS pending,
                count(*) FILTER (WHERE status = 'unsubscribed')::int AS unsubscribed FROM subscribers`),
    nl.pendingDigestReviews(),
    nl.recentDigests(),
  ]);
  res.render('admin/newsletter', {
    title: 'Newsletter', settings, subs, counts, pending, digests, filter, emailEnabled,
    thisWeekSent: digests.find((d) => d.week_key === weekKeyNow() && d.status !== 'failed'),
  });
});

router.get('/newsletter/preview', async (req, res) => {
  const settings = await getSettings();
  const { reviews: list } = await nl.pendingDigestReviews();
  if (!list.length) return res.type('text/plain').send('No new reviews since the last email, so there’s nothing to preview yet.');
  const content = nl.digestContent(settings, list);
  res.set('Content-Security-Policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'");
  res.send(nl.digestPreview(settings, content));
});

router.post('/newsletter/settings', checkCsrf, async (req, res) => {
  const day = Number(req.body.day), hour = Number(req.body.hour);
  await saveSetting('newsletter', {
    autoSend: req.body.autoSend === 'on',
    day: day >= 0 && day <= 6 ? day : DEFAULTS.newsletter.day,
    hour: hour >= 0 && hour <= 23 ? hour : DEFAULTS.newsletter.hour,
  });
  flash(req, 'Newsletter schedule saved.');
  res.redirect(303, '/admin/newsletter');
});

router.post('/newsletter/send', checkCsrf, async (req, res) => {
  try {
    const out = await nl.sendWeeklyDigest();
    const text = {
      sent: `Sent to ${out.recipients} subscriber${out.recipients === 1 ? '' : 's'}.`,
      'already-sent': 'This week’s email has already gone out. New reviews will go in next week’s.',
      'nothing-new': 'There are no new reviews since the last email, so nothing was sent.',
      'no-email': 'Connect an email service first (see the setup guide).',
    }[out.status];
    flash(req, text, out.status === 'sent' ? 'ok' : 'error');
  } catch (err) {
    flash(req, `The email didn’t send: ${err.message}`, 'error');
  }
  res.redirect(303, '/admin/newsletter');
});

router.get('/newsletter/subscribers.csv', async (req, res) => {
  const rows = await many('SELECT email, status, consent_at, confirmed_at, unsubscribed_at, created_at FROM subscribers ORDER BY created_at');
  const head = ['email', 'status', 'consent_at', 'confirmed_at', 'unsubscribed_at', 'created_at'];
  const csv = [head.join(',')].concat(rows.map((r) => head.map((k) => csvCell(r[k] instanceof Date ? r[k].toISOString() : r[k])).join(','))).join('\r\n');
  res.set('Content-Disposition', `attachment; filename="films-on-cue-subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.type('text/csv').send(csv);
});

router.post('/newsletter/subscribers/:id/delete', checkCsrf, async (req, res) => {
  const row = await one('DELETE FROM subscribers WHERE id = $1 RETURNING email', [Number(req.params.id) || 0]);
  if (row) flash(req, `${row.email} was removed.`);
  res.redirect(303, `/admin/newsletter?show=${encodeURIComponent(req.body.show || 'active')}`);
});

/* ---------- messages ---------- */

router.get('/messages', async (req, res) => {
  const rows = await many('SELECT * FROM messages ORDER BY created_at DESC LIMIT 300');
  res.render('admin/messages', { title: 'Messages', rows });
});

router.post('/messages/:id/read', checkCsrf, async (req, res) => {
  await query('UPDATE messages SET is_read = $2 WHERE id = $1', [Number(req.params.id) || 0, req.body.read !== 'no']);
  res.redirect(303, '/admin/messages');
});

router.post('/messages/:id/delete', checkCsrf, async (req, res) => {
  await query('DELETE FROM messages WHERE id = $1', [Number(req.params.id) || 0]);
  flash(req, 'Message deleted.');
  res.redirect(303, '/admin/messages');
});

/* ---------- site settings ---------- */

router.get('/settings', async (req, res) => {
  res.render('admin/settings', { title: 'Site settings', settings: await getSettings(), SOCIAL_PLATFORMS, errors: {} });
});

const t = (v, max) => String(v ?? '').trim().slice(0, max);

router.post('/settings/:section', checkCsrf, async (req, res, next) => {
  const b = req.body;
  const s = await getSettings();
  const section = req.params.section;
  const errors = {};

  if (section === 'socials') {
    const items = {};
    for (const key of Object.keys(SOCIAL_PLATFORMS)) {
      const url = t(b[`${key}_url`], 300);
      if (url && !/^https:\/\/[^\s]+\.[^\s]+$/.test(url)) errors[`${key}_url`] = 'Paste the full link, starting with https://';
      items[key] = { url, visible: b[`${key}_visible`] === 'on' };
    }
    if (!Object.keys(errors).length) await saveSetting('socials', { show: b.show === 'on', items });
  } else if (section === 'home') {
    await saveSetting('home', {
      heading: t(b.heading, 160) || DEFAULTS.home.heading,
      intro: t(b.intro, 400),
      newsletterHeading: t(b.newsletterHeading, 80) || DEFAULTS.home.newsletterHeading,
      newsletterText: t(b.newsletterText, 240),
    });
  } else if (section === 'about') {
    await saveSetting('about', { heading: t(b.heading, 160) || DEFAULTS.about.heading, intro: t(b.intro, 600), bodyHtml: cleanRichText(b.bodyHtml) });
  } else if (section === 'contact') {
    await saveSetting('contact', { heading: t(b.heading, 120) || DEFAULTS.contact.heading, intro: t(b.intro, 400) });
  } else if (section === 'site') {
    const notifyEmail = t(b.notifyEmail, 254);
    if (notifyEmail && !isEmail(notifyEmail)) errors.notifyEmail = 'Enter an email address like name@example.com.';
    if (!Object.keys(errors).length) {
      await saveSetting('site', {
        name: t(b.name, 60) || DEFAULTS.site.name,
        description: t(b.description, 200) || DEFAULTS.site.description,
        reviewer: t(b.reviewer, 80),
        notifyEmail,
      });
    }
  } else if (section === 'privacy') {
    await saveSetting('privacy', { bodyHtml: cleanRichText(b.bodyHtml) || DEFAULTS.privacy.bodyHtml });
  } else {
    return next();
  }

  if (Object.keys(errors).length) {
    // show what they typed, with the problems marked
    const draft = structuredClone(s);
    for (const key of Object.keys(SOCIAL_PLATFORMS)) draft.socials.items[key] = { url: t(b[`${key}_url`], 300), visible: b[`${key}_visible`] === 'on' };
    if (section === 'site') draft.site.notifyEmail = t(b.notifyEmail, 254);
    return res.status(422).render('admin/settings', { title: 'Site settings', settings: draft, SOCIAL_PLATFORMS, errors });
  }
  flash(req, 'Saved.');
  res.redirect(303, `/admin/settings#${section}`);
});
