import nodemailer from 'nodemailer';
import { config, emailReady } from '../config.js';
import { gmailSend } from './gmail.js';
import { retryable } from './actions.js';

let transport = null;
let smtpBlockedUntil = 0;   // after a connection timeout, don't keep waiting 15s on every retry

export function legalFooter() {
  const b = config.business;
  const lines = [
    [b.senderName, b.name].filter(Boolean).join(' | '),
    [b.email, b.phone, b.website].filter(Boolean).join(' | '),
    b.address,
    'Not interested? Just reply "unsubscribe" and I won\'t email you again.',
  ].filter(Boolean);
  return ['', '--', ...lines].join('\n');
}

/**
 * Send one email. Returns the provider message id.
 * Callers must wrap this in runOnce() so a retry can never send twice.
 */
export async function sendMail({ to, subject, text, attachments = [], inReplyTo, references }) {
  if (!emailReady()) throw new Error('Email is not set up yet. Connect Gmail in Connections & Settings (or add SMTP_PASS), and set BUSINESS_NAME and BUSINESS_ADDRESS in Railway.');
  const unsub = `mailto:${config.business.email}?subject=unsubscribe`;
  // Every email carries the legal footer (sender, real address, opt-out), even if a draft lost it while being edited.
  if (!/unsubscribe/i.test(text || '')) text = `${(text || '').trimEnd()}\n${legalFooter()}`;
  const mail = {
    from: config.smtp.from, replyTo: config.business.email, to, subject, text, attachments,
    ...(inReplyTo ? { inReplyTo, references: references || inReplyTo } : {}),
    headers: { 'List-Unsubscribe': `<${unsub}>` },
  };
  // Preferred: Gmail API over HTTPS (works on every Railway plan).
  if (config.gmailApi) return gmailSend(mail);
  if (Date.now() < smtpBlockedUntil) throw retryable(new Error('Email not connected: Railway blocks outgoing email ports on plans below Pro. Click "Connect Gmail" in Connections & Settings. Nothing was sent.'));
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
      connectionTimeout: 15000, greetingTimeout: 15000, socketTimeout: 30000,
    });
  }
  try {
    return await transport.sendMail(mail);
  } catch (e) {
    // These failures happen before any message is handed to Gmail, so nothing was sent and a retry is safe.
    if (NOT_SENT.test(`${e.code || ''} ${e.message || ''}`)) {
      transport = null;
      const blocked = /timeout|ETIMEDOUT|ECONNREFUSED|ESOCKET|Greeting/i.test(`${e.code || ''} ${e.message || ''}`);
      if (blocked) smtpBlockedUntil = Date.now() + 30 * 60000;
      throw retryable(new Error(blocked
        ? 'Email not connected: the worker could not reach Gmail\'s mail server (Railway blocks outgoing email ports on plans below Pro). Click "Connect Gmail" in Connections & Settings to send over HTTPS instead. Nothing was sent.'
        : `Email not connected: Gmail refused the sign-in (${e.message}). Check SMTP_PASS is a current App Password, or click "Connect Gmail". Nothing was sent.`));
    }
    throw e;
  }
}

/** SMTP errors that mean the message never left: connection or login failures. */
export const NOT_SENT = /Connection timeout|ETIMEDOUT|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ESOCKET|Greeting never received|EAUTH|Invalid login|Username and Password not accepted/i;
