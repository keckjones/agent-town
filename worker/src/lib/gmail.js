// Sending (and, for the career account, reading threads) through the Gmail API over HTTPS.
// Why: Railway blocks outgoing SMTP ports (465/587) on plans below Pro, so SMTP times out there.
// Two separate sign-ins, each locked to one address:
//   business → agentickj@gmail.com (agency outreach)              scopes: send
//   career   → your school Gmail, keckjones@tamu.edu (job search)  scopes: send + read (to see replies in its own threads)
// Refresh tokens are stored only in the server-side "secrets" table. Signing in as any other address is refused.
import crypto from 'node:crypto';
import MailComposer from 'nodemailer/lib/mail-composer/index.js';
import { config } from '../config.js';
import { db } from './db.js';
import { retryable } from './actions.js';

const CID = () => (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const CSECRET = () => (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
export const gmailApiConfigured = () => !!(CID() && CSECRET() && config.publicUrl);
const redirect = () => `${config.publicUrl}/oauth/gmail/callback`;
const SEND = 'https://www.googleapis.com/auth/gmail.send', READ = 'https://www.googleapis.com/auth/gmail.readonly', WHO = 'https://www.googleapis.com/auth/userinfo.email';

export async function careerSender() {
  let data = null;
  try { ({ data } = await db.from('career_profile').select('sender_email').eq('id', 1).maybeSingle()); } catch { data = null; }
  return String(data?.sender_email || process.env.CAREER_EMAIL || 'keckjones@tamu.edu').toLowerCase();
}
const ACCOUNTS = {
  business: { key: 'gmail_tokens', integration: 'gmail', label: 'Email (agentickj@gmail.com)', division: 'agency', scopes: [SEND, WHO],
    want: async () => (config.business.email || config.smtp.user || '').toLowerCase(), button: 'Connect Gmail' },
  career: { key: 'gmail_tokens:career', integration: 'career_mail', label: 'Career email (school Gmail)', division: 'career', scopes: [SEND, READ, WHO],
    want: careerSender, button: 'Connect school Gmail' },
};
const acctOf = (a) => ACCOUNTS[a] ? a : 'business';

async function getSecret(id) { const { data } = await db.from('secrets').select('value').eq('id', id).maybeSingle(); return data?.value || null; }
async function setSecret(id, value) { await db.from('secrets').upsert({ id, value, updated_at: new Date().toISOString() }, { onConflict: 'id' }); }

/** Load whether the business Gmail is linked (called at startup and after connecting). Sets config.gmailApi for emailReady(). */
export async function refreshGmailState() {
  const t = await getSecret(ACCOUNTS.business.key).catch(() => null);
  config.gmailApi = !!t?.refresh;
  config.gmailAddress = t?.email || null;
  const c = await getSecret(ACCOUNTS.career.key).catch(() => null);
  config.careerGmail = c?.refresh ? c.email : null;
  return config.gmailApi;
}

export async function gmailConnectUrl(account = 'business') {
  const acct = acctOf(account), A = ACCOUNTS[acct];
  if (!gmailApiConfigured()) throw new Error('Connecting Gmail needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET (Railway Variables) and a generated Railway domain.');
  const state = crypto.randomBytes(18).toString('base64url');
  await setSecret(`gmail_oauth:${state}`, { created: Date.now(), acct });
  const q = new URLSearchParams({ client_id: CID(), redirect_uri: redirect(), response_type: 'code', scope: A.scopes.join(' '), access_type: 'offline',
    prompt: 'consent select_account', state, login_hint: await A.want() });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function gmailCallback(params) {
  const state = params.get('state');
  const pending = state ? await getSecret(`gmail_oauth:${state}`) : null;
  if (!pending?.created || Date.now() - pending.created > 15 * 60000) return { ok: false, message: 'This sign-in link expired. Start again from the dashboard.' };
  await setSecret(`gmail_oauth:${state}`, {});   // single use
  const acct = acctOf(pending.acct), A = ACCOUNTS[acct];
  if (params.get('error')) return { ok: false, message: `Google said: ${params.get('error')}` };
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: params.get('code'), client_id: CID(), client_secret: CSECRET(), redirect_uri: redirect(), grant_type: 'authorization_code' }) });
  const t = await res.json();
  if (!res.ok || !t.refresh_token) return { ok: false, message: `Token error: ${t.error_description || t.error || 'no refresh token returned'}` };
  const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json()).catch(() => ({}));
  const want = await A.want();
  if (want && String(who.email || '').toLowerCase() !== want) return { ok: false, message: `You signed in as ${who.email || 'an unknown account'}, but these emails must come from ${want}. Try again and pick ${want}.` };
  if (!String(t.scope || '').includes('gmail.send')) return { ok: false, message: 'Google did not grant permission to send email. Try again and tick the "Send email on your behalf" box.' };
  if (acct === 'career' && !String(t.scope || '').includes('gmail.readonly')) return { ok: false, message: 'Google did not grant permission to read your email, which the agent needs to notice replies (so it never follows up with someone who already answered). Try again and tick the "Read" box.' };
  await setSecret(A.key, { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 60) * 1000, email: who.email, connected_at: new Date().toISOString() });
  await refreshGmailState();
  await db.from('integrations').upsert({ id: A.integration, name: A.label, status: 'connected', detail: `Sending through the Gmail API as ${who.email}`, checked_at: new Date().toISOString(), division: A.division });
  return { ok: true, message: `Connected as ${who.email}. ${acct === 'career' ? 'Career emails will come from this address.' : 'Approved emails will now send.'} You can close this tab.` };
}

async function token(account = 'business') {
  const A = ACCOUNTS[acctOf(account)];
  const t = await getSecret(A.key);
  if (!t?.refresh) throw retryable(new Error(`Email not connected: click "${A.button}".`));
  if (Date.now() < t.expires) return t;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID(), client_secret: CSECRET(), refresh_token: t.refresh, grant_type: 'refresh_token' }) });
  const j = await res.json();
  if (!res.ok) {
    await db.from('integrations').upsert({ id: A.integration, name: A.label, status: 'error', detail: `Sign-in expired or was revoked (${j.error}). Click "${A.button}" again.`, checked_at: new Date().toISOString(), division: A.division });
    throw retryable(new Error(`Email not connected: the sign-in expired. Click "${A.button}".`));
  }
  const next = { ...t, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
  await setSecret(A.key, next);
  return next;
}

/** Send one message (nodemailer-style options) through the Gmail API. `threadId` keeps a follow-up in the same conversation. */
export async function gmailSend(mail, { account = 'business', threadId = null } = {}) {
  const tk = await token(account);
  const acct = acctOf(account);
  if (acct === 'career') {
    // Hard rule: career mail goes out only as the signed-in school address, never with another From.
    const want = await ACCOUNTS.career.want();
    if (String(tk.email || '').toLowerCase() !== want) throw retryable(new Error(`Email not connected: the career account is signed in as ${tk.email}, not ${want}. Reconnect school Gmail. Nothing was sent.`));
    mail = { ...mail, from: mail.from || `${mail.fromName ? `"${mail.fromName}" ` : ''}<${tk.email}>`, replyTo: undefined };
  }
  const messageId = `<${crypto.randomUUID()}@${(tk.email || config.business.email || 'gmail.com').split('@')[1] || 'gmail.com'}>`;
  const raw = await new MailComposer({ ...mail, messageId }).compile().build();
  const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${tk.access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ raw: raw.toString('base64url'), ...(threadId ? { threadId } : {}) }), signal: AbortSignal.timeout(30000),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = j.error?.message || 'send failed';
    if (/has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(JSON.stringify(j))) {
      throw retryable(new Error('Email not connected: the Gmail API is switched off in your Google Cloud project. In console.cloud.google.com (My First Project) search "Gmail API" → Enable. Wait 2 minutes; this email then sends automatically. Nothing was sent.'));
    }
    if (res.status === 401 || /insufficient|scope|invalid_grant|unauthorized/i.test(msg)) {
      throw retryable(new Error(`Email not connected: Google didn't give permission to send. Click "${ACCOUNTS[acct].button}" and tick "Send email on your behalf". Nothing was sent.`));
    }
    const err = new Error(`Gmail ${res.status}: ${msg}`);
    if (res.status >= 400 && res.status < 500) retryable(err);   // rejected: definitely not sent
    throw err;
  }
  return { messageId, id: j.id, threadId: j.threadId, via: 'gmail_api', from: tk.email };
}

/** Career account only: the messages in one thread (sender, date, snippet). Used to notice replies and bounces. */
export async function gmailThread(threadId, account = 'career') {
  const tk = await token(account);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`,
    { headers: { Authorization: `Bearer ${tk.access}` }, signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${j.error?.message || 'thread read failed'}`);
  const me = String(tk.email || '').toLowerCase();
  return (j.messages || []).map((m) => {
    const h = Object.fromEntries((m.payload?.headers || []).map((x) => [x.name.toLowerCase(), x.value]));
    const from = String(h.from || ''); const addr = (from.match(/<([^>]+)>/)?.[1] || from).trim().toLowerCase();
    return { id: m.id, from, fromAddr: addr, mine: addr === me, subject: h.subject || '', date: Number(m.internalDate) || 0, snippet: m.snippet || '', labels: m.labelIds || [] };
  });
}

/** Career account only: search the mailbox (Gmail search syntax), e.g. `from:someone@x.com newer_than:30d`. */
export async function gmailSearch(q, account = 'career', max = 20) {
  const tk = await token(account);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?q=${encodeURIComponent(q)}&maxResults=${max}`, { headers: { Authorization: `Bearer ${tk.access}` }, signal: AbortSignal.timeout(20000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gmail ${res.status}: ${j.error?.message || 'search failed'}`);
  return (j.messages || []).map((m) => ({ id: m.id, threadId: m.threadId }));
}
