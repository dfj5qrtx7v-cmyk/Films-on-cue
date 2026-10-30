import crypto from 'node:crypto';
import passport from 'passport';
import * as client from 'openid-client';
import { Strategy } from 'openid-client/passport';
import { config } from './config.js';

/*
 * Owner login with Replit Auth (OpenID Connect).
 * Anyone can sign in with a Replit account, but only the owner gets in:
 * OWNER_EMAIL (and/or OWNER_REPLIT_USER_ID) decides who that is.
 */

let oidcConfig = null;
async function getOidcConfig() {
  if (!oidcConfig) {
    oidcConfig = client.discovery(new URL(config.issuerUrl), config.replId).catch((err) => {
      oidcConfig = null;
      throw err;
    });
  }
  return oidcConfig;
}

export const authConfigured = () => Boolean(config.replId);

const registered = new Set();
async function strategyFor(req) {
  const host = req.hostname;
  if (!config.authDomains.includes(host)) {
    const err = new Error(`Login isn’t enabled for ${host}. Add it to the CUSTOM_DOMAINS secret.`);
    err.status = 400;
    throw err;
  }
  const name = `replitauth:${host}`;
  if (!registered.has(name)) {
    const oidc = await getOidcConfig();
    passport.use(new Strategy(
      { name, config: oidc, scope: 'openid email profile', callbackURL: `https://${host}/api/callback` },
      (tokens, done) => {
        const c = tokens.claims();
        done(null, {
          id: c.sub,
          email: (c.email || '').toLowerCase(),
          name: [c.first_name, c.last_name].filter(Boolean).join(' ') || c.email || 'Owner',
          image: c.profile_image_url || null,
        });
      },
    ));
    registered.add(name);
  }
  return name;
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((user, done) => done(null, user));

export function isOwner(user) {
  if (!user) return false;
  if (user.dev) return config.devLogin;
  if (config.ownerIds.includes(user.id)) return true;
  return Boolean(user.email) && config.ownerEmails.includes(user.email);
}

export const ownerConfigured = () => config.ownerEmails.length > 0 || config.ownerIds.length > 0;

function finishLogin(req, res, next, user) {
  const back = req.session.returnTo;
  const to = typeof back === 'string' && back.startsWith('/admin') ? back : '/admin';
  // logIn starts a fresh session, which protects against session fixation
  req.logIn(user, (err) => {
    if (err) return next(err);
    req.session.csrf = crypto.randomBytes(24).toString('base64url');
    req.session.save(() => res.redirect(to));
  });
}

/** Adds the login routes. Passport itself is set up in server.js, before the page data. */
export function mountAuth(app) {
  const isLocal = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress) && ['localhost', '127.0.0.1'].includes(req.hostname);

  app.get('/login', (req, res) => {
    if (isOwner(req.user)) return res.redirect('/admin');
    res.render('pages/login', {
      title: 'Owner login',
      error: req.query.error,
      authReady: authConfigured(),
      ownerReady: ownerConfigured(),
      devLogin: config.devLogin && isLocal(req),
    });
  });

  app.get('/api/login', async (req, res, next) => {
    if (config.devLogin && isLocal(req)) {
      return finishLogin(req, res, next, { id: 'dev', email: 'owner@localhost', name: 'Owner (local)', dev: true });
    }
    if (!authConfigured()) return res.redirect('/login?error=setup');
    try {
      const name = await strategyFor(req);
      passport.authenticate(name, { prompt: 'login consent' })(req, res, next);
    } catch (err) { next(err); }
  });

  app.get('/api/callback', async (req, res, next) => {
    try {
      const name = await strategyFor(req);
      passport.authenticate(name, { session: false }, async (err, user) => {
        if (err) return next(err);
        if (!user) return res.redirect('/login?error=failed');
        if (!isOwner(user)) {
          return res.status(403).render('pages/login', {
            title: 'Owner login', notOwner: user, authReady: true, ownerReady: ownerConfigured(), devLogin: false,
          });
        }
        finishLogin(req, res, next, user);
      })(req, res, next);
    } catch (err) { next(err); }
  });

  app.post('/api/logout', (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      req.session.destroy(() => {
        res.clearCookie('foc.sid');
        res.redirect('/');
      });
    });
  });
}

/** Guards every /admin route. */
export function requireOwner(req, res, next) {
  if (isOwner(req.user)) {
    res.locals.owner = req.user;
    res.locals.csrf = req.session.csrf;
    return next();
  }
  if (req.method === 'GET') req.session.returnTo = req.originalUrl;
  res.redirect('/login');
}

/** Admin forms carry a per-session token so other sites can't submit them. */
export function checkCsrf(req, res, next) {
  const sent = req.body?._csrf || req.get('x-csrf-token');
  const expected = req.session?.csrf;
  if (sent && expected && sent.length === expected.length && crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected))) return next();
  const err = new Error('This form has expired. Go back, refresh the page and try again.');
  err.status = 403;
  next(err);
}
