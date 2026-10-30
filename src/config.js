import crypto from 'node:crypto';

const env = process.env;

/** True when running as a published Replit deployment (or NODE_ENV=production elsewhere). */
export const isProduction = env.REPLIT_DEPLOYMENT === '1' || env.NODE_ENV === 'production';

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

if (!env.SESSION_SECRET && isProduction) {
  console.warn('[config] SESSION_SECRET is not set. Add it in Replit Secrets so logins survive restarts.');
}

export const config = {
  port: Number(env.PORT) || 3000,
  databaseUrl: env.DATABASE_URL,
  sessionSecret: env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),

  /** Public address used in emails, feeds and share links, e.g. https://filmsoncue.com */
  siteUrl: (env.SITE_URL || (env.REPLIT_DOMAINS ? `https://${list(env.REPLIT_DOMAINS)[0]}` : `http://localhost:${Number(env.PORT) || 3000}`)).replace(/\/$/, ''),

  // Owner login (Replit Auth)
  replId: env.REPL_ID,
  issuerUrl: env.ISSUER_URL || 'https://replit.com/oidc',
  authDomains: [...list(env.REPLIT_DOMAINS), ...list(env.REPLIT_DEV_DOMAIN), ...list(env.CUSTOM_DOMAINS)],
  ownerEmails: list(env.OWNER_EMAIL).map((e) => e.toLowerCase()),
  ownerIds: list(env.OWNER_REPLIT_USER_ID),
  // local testing only: never active on Replit or in production
  devLogin: env.DEV_LOGIN === 'true' && !isProduction && !env.REPL_ID,

  // Email (Resend)
  resendKey: env.RESEND_API_KEY,
  emailFrom: env.EMAIL_FROM, // e.g. "Films on Cue <hello@filmsoncue.com>"

  // Optional Cloudflare Turnstile spam check
  turnstileSiteKey: env.TURNSTILE_SITE_KEY,
  turnstileSecret: env.TURNSTILE_SECRET_KEY,

  // Lets a scheduled job trigger the weekly email over HTTP
  cronSecret: env.CRON_SECRET,
};

export const emailEnabled = Boolean(config.resendKey && config.emailFrom);
