import nodemailer from 'nodemailer';
import { config, emailReady } from '../config.js';

let transport = null;

export function legalFooter() {
  const b = config.business;
  const lines = [
    [b.senderName, b.name].filter(Boolean).join(' | '),
    [b.phone, b.website].filter(Boolean).join(' | '),
    b.address,
    'Not interested? Just reply "unsubscribe" and I won\'t email you again.',
  ].filter(Boolean);
  return ['', '--', ...lines].join('\n');
}

export async function sendMail({ to, subject, text, attachments = [] }) {
  if (!emailReady()) throw new Error('Outreach email is not set up yet (SMTP_* and BUSINESS_* variables).');
  if (!transport) {
    transport = nodemailer.createTransport({
      host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465,
      auth: { user: config.smtp.user, pass: config.smtp.pass },
    });
  }
  const unsub = `mailto:${config.smtp.user}?subject=unsubscribe`;
  return transport.sendMail({
    from: config.smtp.from, to, subject, text, attachments,
    headers: { 'List-Unsubscribe': `<${unsub}>` },
  });
}
