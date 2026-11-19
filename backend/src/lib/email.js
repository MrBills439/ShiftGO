/**
 * Transactional email (invitations, password-reset codes).
 *
 *   RESEND_API_KEY set  -> sent through Resend (https://resend.com)
 *   not set, dev        -> printed to the server log (so you can copy the link/code)
 *   not set, production -> throws, so an invitation can never "succeed" without
 *                          an email actually going out
 *   under Jest / node --test -> captured in `outbox` for assertions, never sent
 *
 * EMAIL_FROM must be an address on a domain verified in Resend, e.g.
 *   EMAIL_FROM="ShiftGO <no-reply@yourdomain.com>"
 */
const logger = require('./logger');

const outbox = [];
const isTestRun = () => process.env.JEST_WORKER_ID !== undefined || process.env.SHIFTGO_EMAIL_CAPTURE === 'true';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Minimal, readable HTML wrapper; every message also has a plain-text body. */
function layout(title, paragraphs, action) {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px;line-height:1.5">${escapeHtml(p)}</p>`).join('');
  const button = action
    ? `<p style="margin:22px 0"><a href="${escapeHtml(action.url)}" style="background:#1c7969;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:600">${escapeHtml(action.label)}</a></p>
       <p style="margin:0 0 14px;font-size:13px;color:#555">Or paste this link into your browser:<br>${escapeHtml(action.url)}</p>`
    : '';
  return `<!doctype html><html lang="en"><body style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1815;max-width:560px;margin:0 auto;padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(title)}</h1>${body}${button}
<p style="margin:24px 0 0;font-size:12px;color:#726b64">Sent by LeafRota, a product of PIPCoRD. If you weren't expecting this, you can ignore it.</p></body></html>`;
}

async function sendEmail({ to, subject, text, html }) {
  if (isTestRun()) {
    outbox.push({ to, subject, text, html });
    return { id: `test-${outbox.length}` };
  }
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  // Production never falls back to a default sender: a missing EMAIL_FROM is a
  // configuration error, reported instead of silently sending from elsewhere.
  if (!key || (!from && process.env.NODE_ENV === 'production')) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Email is not configured: set RESEND_API_KEY and EMAIL_FROM.');
    }
    logger.warn('email.not_sent_dev', { to, subject, text });
    return { id: 'logged' };
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: from || 'LeafRota <onboarding@resend.dev>', to: [to], subject, text, html }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    logger.error('email.send_failed', { to, subject, status: res.status, detail: detail.slice(0, 300) });
    throw new Error(`Email provider rejected the message (${res.status}).`);
  }
  return res.json();
}

module.exports = { sendEmail, layout, outbox };
