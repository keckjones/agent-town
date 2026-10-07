// YouTube Data API v3 for brand channels you own: official Google sign-in, verified channel access,
// resumable uploads (private/scheduled), status checks, statistics, and comment reading.
// Tokens live only in the server-side "secrets" table. One token set per brand account.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from './db.js';
import { retryable } from './actions.js';

const CID = () => (process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const CSECRET = () => (process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
export const youtubeReady = () => !!(CID() && CSECRET() && config.publicUrl);
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'];
const redirect = () => `${config.publicUrl}/oauth/youtube/callback`;

async function getSecret(id) { const { data } = await db.from('secrets').select('value').eq('id', id).maybeSingle(); return data?.value || null; }
async function setSecret(id, value) { await db.from('secrets').upsert({ id, value, updated_at: new Date().toISOString() }, { onConflict: 'id' }); }

/** Called from a dashboard command: makes a one-time sign-in link bound to one brand account. */
export async function youtubeConnectUrl(accountId) {
  if (!youtubeReady()) throw new Error('YouTube sign-in needs GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET and a public worker address.');
  const state = crypto.randomBytes(18).toString('base64url');
  await setSecret(`yt_oauth:${state}`, { account_id: accountId, created: Date.now() });
  const q = new URLSearchParams({ client_id: CID(), redirect_uri: redirect(), response_type: 'code', scope: SCOPES.join(' '), access_type: 'offline', prompt: 'consent select_account', state, include_granted_scopes: 'true' });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

export async function youtubeCallback(params) {
  const state = params.get('state');
  const pending = state ? await getSecret(`yt_oauth:${state}`) : null;
  if (!pending?.account_id || Date.now() - pending.created > 15 * 60000) return { ok: false, message: 'This sign-in link expired. Start again from the dashboard.' };
  await setSecret(`yt_oauth:${state}`, {});
  if (params.get('error')) return { ok: false, message: `Google said: ${params.get('error')}` };
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code: params.get('code'), client_id: CID(), client_secret: CSECRET(), redirect_uri: redirect(), grant_type: 'authorization_code' }) });
  const t = await res.json();
  if (!res.ok || !t.refresh_token) return { ok: false, message: `Token error: ${t.error_description || t.error || 'no refresh token returned'}` };
  await setSecret(`account:${pending.account_id}`, { access: t.access_token, refresh: t.refresh_token, expires: Date.now() + (t.expires_in - 60) * 1000, scope: t.scope });
  const ch = await yt(pending.account_id, '/channels?part=snippet,statistics,status&mine=true');
  const c = ch.items?.[0];
  if (!c) {
    await db.from('brand_accounts').update({ status: 'error', health: { error: 'Signed in, but this Google account has no YouTube channel selected.' } }).eq('id', pending.account_id);
    return { ok: false, message: 'Signed in, but no YouTube channel was found. Create the channel first, then connect again and pick it.' };
  }
  await db.from('brand_accounts').update({ status: 'connected', publish_mode: 'api', external_id: c.id, handle: c.snippet?.customUrl || c.snippet?.title,
    profile_url: `https://www.youtube.com/channel/${c.id}`, verified_at: new Date().toISOString(), token_expires_at: null,
    permissions: { scopes: (t.scope || '').split(' ') }, health: { ok: true, subscribers: Number(c.statistics?.subscriberCount || 0), checked_at: new Date().toISOString() },
    updated_at: new Date().toISOString() }).eq('id', pending.account_id);
  const { data: acc } = await db.from('brand_accounts').select('brand_id').eq('id', pending.account_id).single();
  const { recordLink } = await import('./links.js');
  await recordLink({ url: `https://www.youtube.com/channel/${c.id}`, title: c.snippet?.title || 'YouTube channel', kind: 'account', platform: 'youtube', whereItLives: 'YouTube',
    sourceType: 'brand_account', sourceId: pending.account_id, brandId: acc?.brand_id, createdBy: 'account_prov' });
  return { ok: true, message: `Connected "${c.snippet?.title}". You can close this tab.` };
}

async function token(accountId) {
  const t = await getSecret(`account:${accountId}`);
  if (!t?.refresh) throw retryable(new Error('This YouTube channel is not connected.'));
  if (Date.now() < t.expires) return t.access;
  const res = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CID(), client_secret: CSECRET(), refresh_token: t.refresh, grant_type: 'refresh_token' }) });
  const j = await res.json();
  if (!res.ok) {
    await db.from('brand_accounts').update({ status: 'error', health: { error: `Google sign-in expired or was revoked (${j.error}). Reconnect.`, checked_at: new Date().toISOString() } }).eq('id', accountId);
    throw retryable(new Error('YouTube sign-in expired; reconnect needed.'));
  }
  await setSecret(`account:${accountId}`, { ...t, access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

export async function yt(accountId, path, opts = {}) {
  const res = await fetch(`https://www.googleapis.com/youtube/v3${path}`, { ...opts, headers: { Authorization: `Bearer ${await token(accountId)}`, ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const reason = j.error?.errors?.[0]?.reason || j.error?.message || res.status;
    const err = new Error(`YouTube ${res.status}: ${reason}`);
    if (res.status === 403 && /quota/i.test(String(reason))) err.message = 'YouTube daily API quota reached; will retry tomorrow.';
    if (res.status >= 400 && res.status < 500) retryable(err);
    throw err;
  }
  return j;
}

/**
 * Upload exactly one video. Must be called inside runOnce() with a per-item key.
 * privacy: 'private' | 'unlisted' | 'public'. publishAt (ISO) requires private.
 */
export async function uploadVideo(accountId, { buffer, mime = 'video/webm', title, description, tags = [], privacy = 'private', publishAt = null, madeForKids = false, synthetic = false }) {
  const meta = { snippet: { title: title.slice(0, 100), description: description.slice(0, 4900), tags: tags.slice(0, 15), categoryId: '22' },
    status: { privacyStatus: publishAt ? 'private' : privacy, selfDeclaredMadeForKids: madeForKids, containsSyntheticMedia: synthetic, ...(publishAt ? { publishAt } : {}) } };
  const start = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST', headers: { Authorization: `Bearer ${await token(accountId)}`, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': mime, 'X-Upload-Content-Length': String(buffer.length) },
    body: JSON.stringify(meta), signal: AbortSignal.timeout(30000) });
  if (!start.ok) { const e = new Error(`YouTube upload refused (${start.status}): ${(await start.text()).slice(0, 200)}`); if (start.status < 500) retryable(e); throw e; }
  const location = start.headers.get('location');
  const put = await fetch(location, { method: 'PUT', headers: { 'Content-Type': mime, 'Content-Length': String(buffer.length) }, body: buffer, signal: AbortSignal.timeout(10 * 60000) });
  const v = await put.json().catch(() => ({}));
  if (!put.ok || !v.id) throw new Error(`YouTube upload did not complete (${put.status}). Not retrying automatically; check YouTube Studio before trying again.`);
  return { id: v.id, status: v.status?.uploadStatus, privacy: v.status?.privacyStatus, url: `https://www.youtube.com/watch?v=${v.id}` };
}

export async function videoInfo(accountId, id) {
  const j = await yt(accountId, `/videos?part=status,statistics,processingDetails&id=${id}`);
  return j.items?.[0] || null;
}

export async function recentComments(accountId, videoId) {
  const j = await yt(accountId, `/commentThreads?part=snippet&videoId=${videoId}&maxResults=50&order=time`);
  return (j.items || []).map((c) => ({ id: c.id, text: c.snippet?.topLevelComment?.snippet?.textOriginal || '', author: c.snippet?.topLevelComment?.snippet?.authorDisplayName, at: c.snippet?.topLevelComment?.snippet?.publishedAt }));
}
