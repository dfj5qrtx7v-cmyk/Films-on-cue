import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import helmet from 'helmet';
import compression from 'compression';
import passport from 'passport';
import { config, isProduction } from './config.js';
import { migrate, pool } from './db.js';
import { isOwner, mountAuth } from './auth.js';
import publicRoutes from './routes/public.js';
import adminRoutes from './routes/admin.js';
import { getSettings, visibleSocials } from './lib/settings.js';
import { maybeSendDigest } from './lib/newsletter.js';
import { formStamp } from './lib/spam.js';
import * as util from './lib/util.js';
import { icon } from './lib/icons.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = express();

app.set('trust proxy', 1);
app.set('views', path.join(root, 'src', 'views'));
app.set('view engine', 'ejs');
app.disable('x-powered-by');

/* ---------- security headers ---------- */
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.nonce}'`, 'https://challenges.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      fontSrc: ["'self'"],
      connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com', 'https://challenges.cloudflare.com'],
      frameAncestors: ["'self'", 'https://replit.com', 'https://*.replit.com', 'https://*.replit.dev'],
      formAction: ["'self'"],
      baseUri: ["'self'"],
      objectSrc: ["'none'"],
    },
  },
  frameguard: false, // frame-ancestors above lets the site show in Replit's preview pane
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' }, // YouTube embeds need a referrer
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // images are used in emails and link previews
}));
app.use(compression());

/* ---------- static files ---------- */
const assetVersion = crypto.createHash('md5')
  .update(['css/site.css', 'css/admin.css', 'js/site.js', 'js/admin.js'].map((f) => {
    try { return fs.readFileSync(path.join(root, 'public', f)); } catch { return ''; }
  }).join('')).digest('hex').slice(0, 8);

app.use(express.static(path.join(root, 'public'), { maxAge: isProduction ? '7d' : 0, index: false }));
app.use('/vendor/trix', express.static(path.join(root, 'node_modules', 'trix', 'dist'), { maxAge: '30d' }));

/* ---------- forms and sessions ---------- */
app.use(express.urlencoded({ extended: false, limit: '2mb' }));

const PgStore = connectPgSimple(session);
app.use(session({
  store: new PgStore({ pool, tableName: 'session', createTableIfMissing: false, pruneSessionInterval: 60 * 60 }),
  name: 'foc.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 60 * 60 * 1000 },
}));

app.use(passport.initialize());
app.use(passport.session());

/* ---------- shared template data ---------- */
app.use(async (req, res, next) => {
  try {
    const settings = await getSettings();
    Object.assign(res.locals, util, {
      settings,
      socials: visibleSocials(settings),
      siteUrl: config.siteUrl,
      currentPath: req.path,
      currentUrl: req.originalUrl,
      canonical: config.siteUrl + req.path,
      assetVersion,
      icon,
      formStamp,
      turnstileSiteKey: config.turnstileSiteKey,
      ownerSignedIn: isOwner(req.user),
      img: (id, size) => (id ? `/media/${id}${size === 'sm' ? '?s=sm' : ''}` : '/art/placeholder.svg'),
    });
    next();
  } catch (err) { next(err); }
});

/** Rejects form posts that come from another website. */
app.use((req, res, next) => {
  if (req.method !== 'POST' || req.path.startsWith('/newsletter/unsubscribe/') || req.path === '/cron/digest') return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  try {
    const host = new URL(source).hostname;
    if (host === req.hostname || config.authDomains.includes(host)) return next();
  } catch { /* fall through */ }
  res.status(403).render('pages/message', { title: 'Form blocked', heading: 'This form was blocked', text: 'It was sent from another website. Go back to the page and try again.' });
});

// sends the weekly email on schedule when people visit the site
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/media/')) maybeSendDigest();
  next();
});

mountAuth(app);
app.use('/admin', adminRoutes);
app.use(publicRoutes);

/* ---------- errors ---------- */
app.use((req, res) => {
  res.status(404).render('pages/message', {
    title: 'Page not found', heading: 'That page isn’t showing', art: true,
    text: 'The link may be old, or the review may have been taken down.',
    link: { href: '/reviews', label: 'Browse all reviews' },
  });
});

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  const status = err.status || err.statusCode || 500;
  if (status >= 500) console.error(err);
  if (res.headersSent) return;
  if (!res.locals.settings) return res.status(status).type('text/plain').send('Films on Cue is having trouble reaching its database. Try again in a moment.');
  res.status(status).render('pages/message', {
    title: status >= 500 ? 'Something went wrong' : 'Can’t do that',
    heading: status >= 500 ? 'Something went wrong' : 'Can’t do that',
    text: status < 500 || !isProduction ? err.message : 'The page couldn’t load. Try again in a moment.',
  });
});

/* ---------- start ---------- */
await migrate();
app.listen(config.port, '0.0.0.0', () => {
  console.log(`Films on Cue is running on port ${config.port}`);
  if (!config.replId && !config.devLogin) console.log('Owner login needs Replit Auth (REPL_ID), or DEV_LOGIN=true for local testing.');
});
