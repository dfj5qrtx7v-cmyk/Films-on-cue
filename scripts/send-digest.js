#!/usr/bin/env node
/**
 * Sends this week's newsletter if it's due.
 * Used by a Replit Scheduled Deployment so the email goes out even when nobody visits the site.
 *
 *   npm run digest          sends only if the scheduled day and time have passed
 *   npm run digest -- --now sends this week's email straight away (still only once per week)
 */
import { pool } from '../src/db.js';
import { digestIsDue, sendWeeklyDigest } from '../src/lib/newsletter.js';
import { getSettings } from '../src/lib/settings.js';

const now = process.argv.includes('--now');

try {
  const due = now || (await digestIsDue(await getSettings()));
  const result = due ? await sendWeeklyDigest() : { status: 'not-due' };
  console.log('[digest]', result);
} catch (err) {
  console.error('[digest] failed:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
