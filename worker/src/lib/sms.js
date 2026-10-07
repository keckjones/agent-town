// Twilio SMS: send, check delivery, verify webhooks. Credentials live only in Railway variables.
import crypto from 'node:crypto';
import { config, smsReady } from '../config.js';
import { db } from './db.js';
import { retryable } from './actions.js';

const api = () => `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}`;
const auth = () => 'Basic ' + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64');

export function normalizeUsPhone(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d.startsWith('1')) return '+' + d;
  return null;
}

/** Send one SMS. Throws a retryable error only when Twilio clearly refused (nothing was sent). */
export async function sendSms(to, body) {
  if (!smsReady()) throw retryable(new Error('Texting is not set up: add TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_FROM in Railway.'));
  const form = new URLSearchParams({ To: to, Body: body });
  if (config.twilio.messagingServiceSid) form.set('MessagingServiceSid', config.twilio.messagingServiceSid);
  else form.set('From', config.twilio.from);
  if (config.publicUrl) form.set('StatusCallback', `${config.publicUrl}/webhooks/twilio/status`);

  let res;
  try {
    res = await fetch(`${api()}/Messages.json`, {
      method: 'POST', headers: { Authorization: auth(), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form, signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    throw new Error(`Could not reach Twilio (${e.message}). The text may or may not have been sent; not retrying automatically.`);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Twilio refused the text (${res.status} ${j.code || ''}): ${j.message || 'unknown error'}`);
    // 4xx = Twilio rejected the request, nothing was sent → safe to retry after fixing setup.
    if (res.status >= 400 && res.status < 500) retryable(err);
    throw err;
  }
  return { sid: j.sid, status: j.status };
}

export async function fetchSmsStatus(sid) {
  const res = await fetch(`${api()}/Messages/${sid}.json`, { headers: { Authorization: auth() }, signal: AbortSignal.timeout(15000) });
  if (!res.ok) return null;
  const j = await res.json();
  return { status: j.status, errorCode: j.error_code, errorMessage: j.error_message };
}

/** Twilio webhook signature check: HMAC-SHA1 over the full URL + sorted POST params. */
export function validTwilioSignature(url, params, signature) {
  if (!config.twilio.authToken || !signature) return false;
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  const expected = crypto.createHmac('sha1', config.twilio.authToken).update(Buffer.from(data, 'utf-8')).digest('base64');
  const a = Buffer.from(expected), b = Buffer.from(signature);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const FINAL = new Set(['delivered', 'undelivered', 'failed', 'canceled']);

/** Poll Twilio for messages still in flight (works even without a public webhook URL). */
export async function refreshSmsStatuses() {
  if (!smsReady()) return;
  const since = new Date(Date.now() - 48 * 3600e3).toISOString();
  const { data } = await db.from('sms_messages').select('id, provider_sid, status, kind')
    .in('status', ['queued', 'sending', 'sent', 'accepted', 'scheduled']).not('provider_sid', 'is', null).gte('created_at', since).limit(20);
  for (const m of data || []) {
    const s = await fetchSmsStatus(m.provider_sid).catch(() => null);
    if (!s || s.status === m.status) continue;
    await applySmsStatus(m.provider_sid, s.status, s.errorCode ? `${s.errorCode}: ${s.errorMessage || ''}` : null);
  }
}

export async function applySmsStatus(sid, status, error = null) {
  const { data: rows } = await db.from('sms_messages').update({ status, error, updated_at: new Date().toISOString() })
    .eq('provider_sid', sid).select('id, kind, status');
  const row = rows?.[0];
  if (!row) return;
  // Only a delivered TEST message proves the whole chain works.
  if (row.kind === 'test' && status === 'delivered') {
    await db.from('integrations').upsert({ id: 'twilio', name: 'Twilio SMS', division: 'finance', status: 'connected',
      detail: `Test text delivered ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}`, checked_at: new Date().toISOString() });
  }
  if (FINAL.has(status) && status !== 'delivered') {
    await db.from('integrations').upsert({ id: 'twilio', name: 'Twilio SMS', division: 'finance', status: 'error',
      detail: `Last text ${status}${error ? ` (${error})` : ''}. Carriers block US texts until the Twilio number is registered (A2P 10DLC or toll-free verification).`,
      checked_at: new Date().toISOString() });
  }
}
