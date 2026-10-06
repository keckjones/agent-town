import nodemailer from 'nodemailer';
import { config, emailReady } from '../config.js';

let transport = null;

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
  if (!emailReady()) throw new Error('Email is not set up yet. Add SMTP_PASS (a Google App Password for agentickj@gmail.com) in Railway.');
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  const unsub = `mailto:${config.business.email}?subject=unsubscribe`;
  return transport.sendMail({
    from: config.smtp.from, replyTo: config.business.email, to, subject, text, attachments,
    ...(inReplyTo ? { inReplyTo, references: references || inReplyTo } : {}),
    headers: { 'List-Unsubscribe': `<${unsub}>` },
  });
}
