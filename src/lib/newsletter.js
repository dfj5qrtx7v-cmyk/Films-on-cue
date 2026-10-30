import { config, emailEnabled } from '../config.js';
import { many, one, query } from '../db.js';
import { sendBatch, sendEmail } from './email.js';
import { publishedSince } from './reviews.js';
import { getSettings } from './settings.js';
import { escapeHtml, formatDate, londonNow, starsText, token, weekKey } from './util.js';

/* ---------- subscribing ---------- */

/**
 * Adds or re-activates a subscriber.
 * With email set up, people confirm by clicking a link (double opt-in);
 * without it, they're added straight away.
 */
export async function subscribe(email) {
  email = email.trim().toLowerCase();
  const existing = await one('SELECT * FROM subscribers WHERE email = $1', [email]);
  if (existing?.status === 'active') return 'subscribed';

  const status = emailEnabled ? 'pending' : 'active';
  let sub;
  if (existing) {
    // don't let the form be used to flood someone's inbox with confirmation emails
    if (existing.status === 'pending' && Date.now() - new Date(existing.consent_at) < 10 * 60 * 1000) return 'check-email';
    sub = await one(
      `UPDATE subscribers SET status = $2, consent_at = now(), unsubscribed_at = NULL,
         confirmed_at = CASE WHEN $2 = 'active' THEN now() ELSE confirmed_at END
       WHERE id = $1 RETURNING *`,
      [existing.id, status],
    );
  } else {
    sub = await one(
      `INSERT INTO subscribers (email, status, token, confirmed_at) VALUES ($1, $2, $3, CASE WHEN $2 = 'active' THEN now() END) RETURNING *`,
      [email, status, token()],
    );
  }
  if (status === 'active') return 'subscribed';

  const settings = await getSettings();
  const link = `${config.siteUrl}/newsletter/confirm/${sub.token}`;
  await sendEmail({
    to: email,
    subject: `Confirm your ${settings.site.name} subscription`,
    text: `Confirm you'd like the weekly ${settings.site.name} email:\n\n${link}\n\nIf you didn't ask for this, ignore this email and you won't hear from us.`,
    html: emailShell(settings, `
      <h1 style="${H1}">Confirm your subscription</h1>
      <p style="${P}">Click below to start getting the weekly ${escapeHtml(settings.site.name)} email with every new review.</p>
      <p style="margin:28px 0"><a href="${link}" style="${BUTTON}">Confirm subscription</a></p>
      <p style="${SMALL}">If you didn’t ask for this, ignore this email and you won’t hear from us.</p>`),
  });
  return 'check-email';
}

export async function confirm(tokenValue) {
  return one(
    `UPDATE subscribers SET status = 'active', confirmed_at = COALESCE(confirmed_at, now())
     WHERE token = $1 AND status IN ('pending', 'active') RETURNING email`,
    [tokenValue],
  );
}

export async function findByToken(tokenValue) {
  return one('SELECT email, status FROM subscribers WHERE token = $1', [tokenValue]);
}

export async function unsubscribe(tokenValue) {
  return one(
    `UPDATE subscribers SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, now())
     WHERE token = $1 RETURNING email`,
    [tokenValue],
  );
}

/* ---------- weekly digest ---------- */

const H1 = 'font-family:Georgia,serif;font-weight:400;font-size:28px;line-height:1.2;margin:0 0 16px;color:#000';
const H2 = 'font-family:Georgia,serif;font-weight:400;font-size:22px;line-height:1.25;margin:0 0 6px;color:#000';
const P = 'font-size:16px;line-height:1.55;margin:0 0 14px;color:#000';
const SMALL = 'font-size:13px;line-height:1.5;color:#5e5e5e;margin:0';
const BUTTON = 'display:inline-block;background:#000;color:#fff;text-decoration:none;padding:12px 20px;font-weight:600;font-size:15px';

function emailShell(settings, inner, footer = '') {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;background:#fff;font-family:Helvetica,Arial,sans-serif;color:#000">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:24px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px">
<tr><td style="border-bottom:2px solid #000;padding:0 0 14px"><a href="${config.siteUrl}" style="font-family:Georgia,serif;font-size:24px;color:#000;text-decoration:none">${escapeHtml(settings.site.name)}</a></td></tr>
<tr><td style="padding:28px 0">${inner}</td></tr>
<tr><td style="border-top:1px solid #d4d4d4;padding:16px 0 0">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export function digestContent(settings, reviews) {
  const items = reviews.map((r) => {
    const url = `${config.siteUrl}/reviews/${r.slug}`;
    const img = r.image_id ? `<a href="${url}"><img src="${config.siteUrl}/media/${r.image_id}.jpg?s=sm" width="600" alt="${escapeHtml(r.image_alt || r.title)}" style="display:block;width:100%;height:auto;margin:0 0 14px;border:0"></a>` : '';
    return `<tr><td style="padding:0 0 32px">${img}
      <h2 style="${H2}"><a href="${url}" style="color:#000;text-decoration:none">${escapeHtml(r.title)}${r.release_year ? ` (${r.release_year})` : ''}</a></h2>
      <p style="font-size:18px;letter-spacing:2px;margin:0 0 10px" aria-label="Rated ${r.rating} out of 5">${starsText(r.rating)}</p>
      <p style="${P}">${escapeHtml(r.excerpt)}</p>
      <a href="${url}" style="color:#000;font-weight:600">Read the review</a></td></tr>`;
  }).join('');
  const subject = reviews.length === 1
    ? `New review: ${reviews[0].title}`
    : `This week: ${reviews.slice(0, 2).map((r) => r.title).join(', ')}${reviews.length > 2 ? ` and ${reviews.length - 2} more` : ''}`;
  const inner = `<h1 style="${H1}">This week’s reviews</h1>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${items}</table>`;
  const text = `This week's reviews from ${settings.site.name}\n\n` + reviews.map((r) =>
    `${r.title}${r.release_year ? ` (${r.release_year})` : ''} - ${starsText(r.rating)}\n${r.excerpt}\n${config.siteUrl}/reviews/${r.slug}\n`).join('\n');
  return { subject, inner, text };
}

/** What a subscriber will see, with a dummy unsubscribe link. */
export function digestPreview(settings, content) {
  return emailShell(settings, content.inner, `<p style="${SMALL}">Subscribers see an unsubscribe link here.</p>`);
}

function personalise(settings, content, sub) {
  const unsub = `${config.siteUrl}/newsletter/unsubscribe/${sub.token}`;
  const footer = `<p style="${SMALL}">You’re getting this because you subscribed at ${escapeHtml(config.siteUrl.replace(/^https?:\/\//, ''))}. <a href="${unsub}" style="color:#5e5e5e">Unsubscribe</a></p>`;
  return {
    to: sub.email,
    subject: content.subject,
    html: emailShell(settings, content.inner, footer),
    text: `${content.text}\n--\nUnsubscribe: ${unsub}`,
    headers: { 'List-Unsubscribe': `<${unsub}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

/** Reviews that would go in the next email: everything published since the last one was sent. */
export async function pendingDigestReviews() {
  const last = await one(`SELECT sent_at FROM digests WHERE status = 'sent' ORDER BY sent_at DESC LIMIT 1`);
  const since = last?.sent_at || new Date(Date.now() - 7 * 24 * 3600 * 1000);
  return { since, reviews: await publishedSince(since) };
}

/** True once this week's send time (UK) has passed and nothing has gone out this week. */
export async function digestIsDue(settings) {
  const s = settings.newsletter;
  if (!s.autoSend) return false;
  const now = londonNow();
  const today = (now.day + 6) % 7; // Monday = 0
  const target = (Number(s.day) + 6) % 7;
  if (today < target || (today === target && now.hour < Number(s.hour))) return false;
  return !(await one('SELECT 1 FROM digests WHERE week_key = $1', [weekKey()]));
}

/**
 * Sends this week's email to every active subscriber, at most once per week,
 * even if several servers try at the same moment.
 */
export async function sendWeeklyDigest() {
  if (!emailEnabled) return { status: 'no-email' };
  const key = weekKey();
  const claim = await one(
    `INSERT INTO digests (week_key) VALUES ($1)
     ON CONFLICT (week_key) DO UPDATE SET status = 'sending', error = NULL, created_at = now()
       WHERE digests.status = 'failed'
     RETURNING id`,
    [key],
  );
  if (!claim) return { status: 'already-sent' };

  try {
    const settings = await getSettings();
    const { reviews } = await pendingDigestReviews();
    if (!reviews.length) {
      await query(`UPDATE digests SET status = 'skipped', sent_at = now() WHERE id = $1`, [claim.id]);
      return { status: 'nothing-new' };
    }
    const subs = await many(`SELECT email, token FROM subscribers WHERE status = 'active' ORDER BY id`);
    const content = digestContent(settings, reviews);
    const sent = await sendBatch(subs.map((s) => personalise(settings, content, s)));
    await query(
      `UPDATE digests SET status = 'sent', sent_at = now(), recipients = $2, review_ids = $3 WHERE id = $1`,
      [claim.id, sent, reviews.map((r) => r.id)],
    );
    return { status: 'sent', recipients: sent, reviews: reviews.length };
  } catch (err) {
    await query(`UPDATE digests SET status = 'failed', error = $2 WHERE id = $1`, [claim.id, String(err.message).slice(0, 500)]);
    throw err;
  }
}

/** Checked on site visits, so the email goes out on schedule without a separate job. */
let lastCheck = 0;
export function maybeSendDigest() {
  if (!emailEnabled || Date.now() - lastCheck < 10 * 60 * 1000) return;
  lastCheck = Date.now();
  getSettings()
    .then((s) => digestIsDue(s))
    .then((due) => (due ? sendWeeklyDigest() : null))
    .then((r) => r && console.log('[digest]', r))
    .catch((err) => console.error('[digest] failed:', err.message));
}

export async function recentDigests(limit = 8) {
  return many('SELECT * FROM digests ORDER BY created_at DESC LIMIT $1', [limit]);
}

/* ---------- contact notifications ---------- */

export async function notifyOwnerOfMessage(msg) {
  const settings = await getSettings();
  const to = settings.site.notifyEmail || config.ownerEmails[0];
  if (!to) return false;
  const rows = [['Name', msg.name], ['Email', msg.email], ['Phone', msg.phone || 'Not given'], ['Sent', formatDate(new Date())]];
  return sendEmail({
    to,
    replyTo: msg.email,
    subject: `New message from ${msg.name}`,
    text: `${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${msg.message}\n\nReply to this email to answer ${msg.name}.`,
    html: emailShell(settings, `
      <h1 style="${H1}">New message from ${escapeHtml(msg.name)}</h1>
      <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 18px">${rows.map(([k, v]) =>
        `<tr><td style="font-size:14px;color:#5e5e5e;padding:2px 16px 2px 0">${k}</td><td style="font-size:14px">${escapeHtml(v)}</td></tr>`).join('')}</table>
      <p style="${P};white-space:pre-wrap">${escapeHtml(msg.message)}</p>
      <p style="${SMALL}">Reply to this email to answer ${escapeHtml(msg.name)}. The message is also in your dashboard.</p>`),
  });
}
