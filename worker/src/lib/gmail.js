// Sending email through the Gmail API (HTTPS) instead of SMTP.
// Why: Railway blocks outgoing SMTP ports (465/587) on plans below Pro, so SMTP times out there.
// The Gmail API uses normal HTTPS, which is never blocked. You sign in once as agentickj@gmail.com;
// the refresh token is stored only in the server-side "secrets" table.
import crypto from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { config } from '../config.js';
import { db } from './db.js';
import { retryable } from './actions.js';

const CID = () => (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const CSECRET = () => (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
export const gmailApiConfigured = () => !!(CID() && CSECRET() && config.publicUrl);
const SCOPES = ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/userinfo.email'];
const redirect = () => `${config.publicUrl}/oauth/gmail/callback`;
const KEY = 'gmail_tokens';

async function getSecret(id) { const { data } = await db.from('secrets').select('value').eq('id', id).maybeSingle(); return data?.value || null; }
async function setSecret(id, value) { await db.from('secrets').upsert({ id, value, updated_at: new Date().toISOString() }, { onConflict: 'id' }); }

/** Load whether Gmail is linked (called at startup and after connecting). Sets config.gmailApi for emailReady(). */
export async function refreshGmailState() {
  const t = await getSecret(KEY).catch(() => null);
  config.gmailApi = !!t?.refresh;
  config.gmailAddress = t?.email || null;
  return config.gmailApi;
}

export async function gmailConnectUrl() {
  if (!gmailApiConfigured()) throw new Error('Connecting Gmail needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (Railway Variables) and a generated Railway domain.');
  const state = crypto.randomBytes(18).toString('base64url');
  await setSecret(`gmail_oauth:${state}`, { created: Date.now() });
  const q = new URLSearchParams({ client_id: CID(), redirect_uri: redirect(), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline',
    prompt: 'consent select_account', state, login_hint: config.business.email || '' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function gmailCallback(params) {
  const state = params.get('state');
  const pending = state ? await getSecret(`gmail_oauth:${state}`) : null;
  if (!pending?.created || Date.now() - pending.created > 15 * 60000) return { ok: false, message: 'This sign-in link expired. Start again from the dashboard.' };
  await setSecret(`gmail_oauth:${state}`, {});   // single use
  if (params.get('error')) return { ok: false, message: `Google said: ${params.get('error')}` };
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: params.get('code'), client_id: CID(), client_secret: CSECRET(), redirect_uri: redirect(), grant_type: 'authorization_code' }) });
  const t = await res.json();
  if (!res.ok || !t.refresh_token) return { ok: false, message: `Token error: ${t.error_description || t.error || 'no refresh token returned'}` };
  const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  const want = (config.business.email || config.smtp.user || '').toLowerCase();
  if (want && String(who.email || '').toLowerCase() !== want) return { ok: false, message: `You signed in as ${who.email || 'an unknown account'}, but emails must come from ${want}. Try again and pick ${want}.` };
  if (!String(t.scope || '').includes('gmail.send')) return { ok: false, message: 'Google did not grant permission to send email. Try again and tick the "Send email on your behalf" box.' };
  await setSecret(KEY, { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 60) * 1000, email: who.email, connected_at: new Date().toISOString() });
  await refreshGmailState();
  await db.from('integrations').upsert({ id: 'gmail', name: 'Email (agentickj@gmail.com)', status: 'connected', detail: `Sending through the Gmail API as ${who.email}`, checked_at: new Date().toISOString(), division: 'agency' });
  return { ok: true, message: `Gmail connected as ${who.email}. Approved emails will now send. You can close this tab.` };
}

async function token() {
  const t = await getSecret(KEY);
  if (!t?.refresh) throw retryable(new Error('Gmail is not connected.'));
  if (Date.now() < t.expires) return t.access;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID(), client_secret: CSECRET(), refresh_token: t.refresh, grant_type: 'refresh_token' }) });
  const j = await res.json();
  if (!res.ok) {
    await db.from('integrations').upsert({ id: 'gmail', name: 'Email (agentickj@gmail.com)', status: 'error', detail: `Gmail sign-in expired or was revoked (${j.error}). Click "Connect Gmail" again.`, checked_at: new Date().toISOString(), division: 'agency' });
    throw retryable(new Error('Email not connected: the Gmail sign-in expired. Click "Connect Gmail" in Connections & Settings.'));
  }
  await setSecret(KEY, { ...t, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

/** Send one message (nodemailer-style options) through the Gmail API. */
export async function gmailSend(mail) {
  const messageId = `<${crypto.randomUUID()}@${(config.business.email || 'gmail.com').split('@')[1] || 'gmail.com'}>`;
  const raw = await new MailComposer({ ...mail, messageId }).compile().build();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: raw.toString('base64url') }), signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Gmail ${res.status}: ${j.error?.message || 'send failed'}`);
    if (res.status >= 400 && res.status < 500) retryable(err);   // rejected: definitely not sent
    throw err;
  }
  return { messageId, id: j.id, threadId: j.threadId, via: 'gmail_api' };
}
