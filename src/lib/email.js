import { config, emailEnabled } from '../config.js';

const API = 'https://api.resend.com';

async function call(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.resendKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Email provider returned ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

/** Sends one email. Returns false (and logs) when email isn't set up yet. */
export async function sendEmail({ to, subject, html, text, replyTo, headers }) {
  if (!emailEnabled) {
    console.log(`[email] not configured; would send "${subject}" to ${to}`);
    return false;
  }
  await call('/emails', { from: config.emailFrom, to: [to], subject, html, text, reply_to: replyTo, headers });
  return true;
}

/** Sends many individual emails, 100 per request (the provider's batch limit). */
export async function sendBatch(messages) {
  if (!emailEnabled) {
    console.log(`[email] not configured; would send ${messages.length} emails`);
    return 0;
  }
  let sent = 0;
  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100).map((m) => ({ from: config.emailFrom, to: [m.to], subject: m.subject, html: m.html, text: m.text, headers: m.headers }));
    await call('/emails/batch', chunk);
    sent += chunk.length;
  }
  return sent;
}
