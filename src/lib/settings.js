import { many, query } from '../db.js';

export const SOCIAL_PLATFORMS = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  tiktok: 'TikTok',
  letterboxd: 'Letterboxd',
  youtube: 'YouTube',
};

/** Everything the owner can change from the dashboard, with the copy the site launches with. */
export const DEFAULTS = {
  site: {
    name: 'Films on Cue',
    description: 'Film reviews of the latest releases in cinemas and on streaming, every week.',
    reviewer: '',
    notifyEmail: '',
  },
  home: {
    heading: 'What’s worth seeing this week, and what isn’t.',
    intro: 'Straight-talking reviews of new films in cinemas and on streaming, so you can pick tonight’s film with confidence.',
    newsletterHeading: 'Reviews in your inbox',
    newsletterText: 'One email a week with every new review. Unsubscribe any time.',
  },
  about: {
    heading: 'Reviews for people who love going to the pictures.',
    intro: 'Films on Cue is an independent film review site. We watch the new releases each week and tell you plainly whether they’re worth your time and money.',
    bodyHtml:
      '<h2>How we rate</h2>' +
      '<p><strong>5 stars:</strong> a must-see. Book the tickets.</p>' +
      '<p><strong>4 stars:</strong> excellent, with small flaws.</p>' +
      '<p><strong>3 stars:</strong> good, especially if the subject is your thing.</p>' +
      '<p><strong>2 stars:</strong> some good moments, but hard to recommend.</p>' +
      '<p><strong>1 star:</strong> skip it.</p>' +
      '<h2>Independent</h2>' +
      '<p>We choose what to review, and our verdicts are our own. If we were invited to a press screening, the review says so.</p>',
  },
  contact: {
    heading: 'Get in touch',
    intro: 'Questions, press screenings, or a film you think we should review? Send a message and we’ll reply within a few days.',
  },
  socials: {
    show: true,
    items: {
      instagram: { url: '', visible: true },
      facebook: { url: '', visible: true },
      tiktok: { url: '', visible: true },
      letterboxd: { url: '', visible: false },
      youtube: { url: '', visible: false },
    },
  },
  newsletter: {
    autoSend: true,
    day: 5, // Friday, when new films open in UK cinemas
    hour: 9,
  },
  privacy: {
    bodyHtml:
      '<h2>Who we are</h2>' +
      '<p>Films on Cue is a film review website. If you have a question about your data, use the contact page.</p>' +
      '<h2>What we collect</h2>' +
      '<p><strong>Newsletter:</strong> your email address and the date you agreed to receive it. We use it only to send the weekly Films on Cue email.</p>' +
      '<p><strong>Contact form:</strong> your name, email, message and, if you give it, your phone number. We use these only to reply to you.</p>' +
      '<h2>How long we keep it</h2>' +
      '<p>Newsletter addresses are kept until you unsubscribe. Contact messages are deleted once they are no longer needed.</p>' +
      '<h2>Who we share it with</h2>' +
      '<p>We never sell your data. Emails are delivered by our email provider, and the site and its database are hosted by Replit.</p>' +
      '<h2>Cookies</h2>' +
      '<p>The public site doesn’t set tracking cookies. A cookie is only used to keep the site owner signed in.</p>' +
      '<h2>Your rights</h2>' +
      '<p>You can unsubscribe with the link in any newsletter, and you can ask us to see or delete your data using the contact page. You can also complain to the Information Commissioner’s Office (ico.org.uk).</p>',
  },
};

let cache = null;
let cachedAt = 0;
const TTL = 30_000;

function merge(base, over) {
  if (Array.isArray(base) || typeof base !== 'object' || base === null) return over === undefined ? base : over;
  const out = { ...base };
  for (const k of Object.keys(over || {})) out[k] = merge(base[k], over[k]);
  return out;
}

export async function getSettings() {
  if (cache && Date.now() - cachedAt < TTL) return cache;
  const rows = await many('SELECT key, value FROM settings');
  const saved = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  cache = merge(DEFAULTS, saved);
  cachedAt = Date.now();
  return cache;
}

export async function saveSetting(key, value) {
  await query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
  cache = null;
}

/** Social links that should appear on the site, in display order. */
export function visibleSocials(settings) {
  if (!settings.socials.show) return [];
  return Object.entries(SOCIAL_PLATFORMS)
    .map(([key, label]) => ({ key, label, ...settings.socials.items[key] }))
    .filter((s) => s.visible && s.url);
}
