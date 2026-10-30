import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Light spam protection for the public forms:
 *  - a hidden "website" field that people never fill in but bots do
 *  - a signed timestamp, so forms sent within 2 seconds of loading are ignored
 *  - Cloudflare Turnstile, if TURNSTILE keys are set
 */
const sign = (v) => crypto.createHmac('sha256', config.sessionSecret).update(v).digest('base64url').slice(0, 16);

export function formStamp() {
  const t = Date.now().toString(36);
  return `${t}.${sign(t)}`;
}

export async function looksLikeSpam(req) {
  const body = req.body || {};
  if (body.website) return true;
  const [t, sig] = String(body.stamp || '').split('.');
  if (!t || sig !== sign(t)) return true;
  const age = Date.now() - parseInt(t, 36);
  if (age < 2000 || age > 1000 * 60 * 60 * 24) return true;
  if (config.turnstileSecret) {
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: config.turnstileSecret, response: body['cf-turnstile-response'] || '', remoteip: req.ip }),
      });
      const out = await res.json();
      if (!out.success) return true;
    } catch (err) {
      console.error('[spam] Turnstile check failed', err.message);
    }
  }
  return false;
}
