// Etsy Open API v3 for your own shop: sign-in (OAuth 2 with PKCE), draft listings, digital files, and orders.
// Tokens are stored server-side only (the "secrets" table has no dashboard access).
import crypto from 'node:crypto';
import { config, etsyReady } from '../config.js';
import { db, setIntegration, say } from './db.js';
import { retryable } from './actions.js';

const SCOPES = 'listings_r listings_w transactions_r shops_r profile_r';
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const redirectUri = () => `${config.publicUrl}/oauth/etsy/callback`;
const apiKeyHeader = () => (config.etsy.sharedSecret ? `${config.etsy.apiKey}:${config.etsy.sharedSecret}` : config.etsy.apiKey);

async function getSecret(id) { const { data } = await db.from('secrets').select('value').eq('id', id).maybeSingle(); return data?.value || null; }
async function setSecret(id, value) { await db.from('secrets').upsert({ id, value, updated_at: new Date().toISOString() }); }

export async function etsyAuthStart() {
  if (!etsyReady() || !config.publicUrl) throw new Error('Etsy needs ETSY_API_KEY and a public worker URL first.');
  const verifier = b64url(crypto.randomBytes(48));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(18));
  await setSecret('etsy_oauth_pending', { state, verifier, created: Date.now() });
  const q = new URLSearchParams({ response_type: 'code', redirect_uri: redirectUri(), scope: SCOPES, client_id: config.etsy.apiKey,
    state, code_challenge: challenge, code_challenge_method: 'S256' });
  return `https://www.etsy.com/oauth/connect?${q}`;
}

export async function etsyAuthCallback(params) {
  const pending = await getSecret('etsy_oauth_pending');
  if (!pending || params.get('state') !== pending.state || Date.now() - pending.created > 15 * 60000) {
    return { ok: false, message: 'This sign-in link expired or did not match. Start again from the dashboard.' };
  }
  if (params.get('error')) return { ok: false, message: `Etsy said: ${params.get('error_description') || params.get('error')}` };
  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: config.etsy.apiKey, redirect_uri: redirectUri(), code: params.get('code'), code_verifier: pending.verifier }),
  });
  const j = await res.json();
  if (!res.ok) return { ok: false, message: `Etsy token error: ${j.error_description || j.error || res.status}` };
  await setSecret('etsy_tokens', { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  await setSecret('etsy_oauth_pending', {});
  const me = await etsyApi('/users/me');
  await setSecret('etsy_shop', { user_id: me.user_id, shop_id: me.shop_id });
  await setIntegration('etsy', 'Etsy', me.shop_id ? 'connected' : 'error', me.shop_id ? `Shop ${me.shop_id} connected` : 'Signed in, but this Etsy account has no shop yet.', null, 'etsy');
  return { ok: true, message: me.shop_id ? 'Your Etsy shop is connected. You can close this tab.' : 'Signed in, but no shop was found on this Etsy account.' };
}

async function accessToken() {
  const t = await getSecret('etsy_tokens');
  if (!t?.access) throw retryable(new Error('Etsy is not connected yet. Use "Connect Etsy" in the dashboard.'));
  if (Date.now() < t.expires) return t.access;
  const res = await fetch('https://api.etsy.com/v3/public/oauth/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: config.etsy.apiKey, refresh_token: t.refresh }),
  });
  const j = await res.json();
  if (!res.ok) {
    await setIntegration('etsy', 'Etsy', 'error', 'Etsy sign-in expired. Reconnect from the dashboard.', null, 'etsy');
    throw retryable(new Error('Etsy sign-in expired; reconnect needed.'));
  }
  await setSecret('etsy_tokens', { access: j.access_token, refresh: j.refresh_token, expires: Date.now() + (j.expires_in - 60) * 1000 });
  return j.access_token;
}

export async function etsyApi(path, { method = 'GET', form, json, multipart } = {}) {
  const headers = { 'x-api-key': apiKeyHeader(), Authorization: `Bearer ${await accessToken()}` };
  let body;
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(form); }
  if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (multipart) body = multipart;
  const res = await fetch(`https://api.etsy.com/v3/application${path}`, { method, headers, body, signal: AbortSignal.timeout(30000) });
  if (res.status === 429) throw retryable(new Error('Etsy rate limit reached; will retry later.'));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Etsy ${res.status}: ${j.error || JSON.stringify(j).slice(0, 200)}`);
    if (res.status >= 400 && res.status < 500) retryable(err);
    throw err;
  }
  return j;
}

export async function shopId() {
  const s = await getSecret('etsy_shop');
  if (!s?.shop_id) throw retryable(new Error('No Etsy shop connected.'));
  return s.shop_id;
}

/** Pick the closest seller taxonomy node for a hint like "Planners & Templates". */
export async function findTaxonomy(hint) {
  let nodes = (await getSecret('etsy_taxonomy'))?.nodes;
  if (!nodes) {
    const j = await etsyApi('/seller-taxonomy/nodes');
    const flat = [];
    const walk = (list, path = []) => { for (const n of list || []) { flat.push({ id: n.id, path: [...path, n.name].join(' > ') }); walk(n.children, [...path, n.name]); } };
    walk(j.results);
    nodes = flat;
    await setSecret('etsy_taxonomy', { nodes, at: Date.now() });
  }
  const words = String(hint || '').toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  let best = null, bestScore = -1;
  for (const n of nodes) {
    const p = n.path.toLowerCase();
    const score = words.reduce((s, w) => s + (p.includes(w) ? 1 : 0), 0) - p.split('>').length * 0.01;
    if (score > bestScore) { best = n; bestScore = score; }
  }
  return best;
}

/** Create a DRAFT listing (Etsy charges the listing fee when it is published). */
export async function createDraftListing(listing) {
  const shop = await shopId();
  const tax = await findTaxonomy(listing.taxonomy_hint || listing.title);
  const form = {
    quantity: String(listing.quantity || 999), title: listing.title.slice(0, 140), description: listing.description,
    price: String(listing.price_usd), who_made: 'i_did', when_made: listing.when_made || 'made_to_order',
    taxonomy_id: String(tax?.id || listing.taxonomy_id), type: listing.digital ? 'download' : 'physical',
    is_supply: 'false',
  };
  (listing.tags || []).slice(0, 13).forEach((t, i) => { form[`tags[${i}]`] = String(t).slice(0, 20); });
  return etsyApi(`/shops/${shop}/listings`, { method: 'POST', form });
}

export async function uploadListingImage(listingId, buffer, filename = 'mockup.jpg', rank = 1) {
  const shop = await shopId();
  const fd = new FormData();
  fd.append('image', new Blob([buffer], { type: 'image/jpeg' }), filename);
  fd.append('rank', String(rank));
  return etsyApi(`/shops/${shop}/listings/${listingId}/images`, { method: 'POST', multipart: fd });
}

export async function uploadListingFile(listingId, buffer, name) {
  const shop = await shopId();
  const fd = new FormData();
  fd.append('file', new Blob([buffer], { type: 'application/pdf' }), name);
  fd.append('name', name);
  return etsyApi(`/shops/${shop}/listings/${listingId}/files`, { method: 'POST', multipart: fd });
}

export async function publishListing(listingId) {
  const shop = await shopId();
  return etsyApi(`/shops/${shop}/listings/${listingId}`, { method: 'PATCH', form: { state: 'active' } });
}

/** Pull recent paid orders (receipts) into the orders table. Idempotent by receipt id. */
export async function syncEtsyOrders() {
  const shop = await shopId();
  const since = Math.floor((Date.now() - 14 * 864e5) / 1000);
  const j = await etsyApi(`/shops/${shop}/receipts?was_paid=true&min_created=${since}&limit=100`);
  let added = 0;
  for (const r of j.results || []) {
    const amount = (r.grandtotal?.amount || 0) / (r.grandtotal?.divisor || 100);
    const listingIds = (r.transactions || []).map((t) => t.listing_id);
    const { data: prod } = listingIds.length ? await db.from('products').select('id, fulfillment_model').in('etsy_listing_id', listingIds.map(String)).limit(1) : { data: [] };
    const digital = (r.transactions || []).every((t) => t.is_digital);
    const status = r.status === 'Completed' ? (digital ? 'delivered' : 'shipped') : r.is_shipped ? 'shipped' : (r.status === 'Canceled' ? 'cancelled' : 'new');
    const { data: existing } = await db.from('orders').select('id, status').eq('external_id', `etsy:${r.receipt_id}`).maybeSingle();
    const row = { platform: 'etsy', external_id: `etsy:${r.receipt_id}`, product_id: prod?.[0]?.id || null, amount_usd: amount,
      status: existing && ['exception', 'refunded'].includes(existing.status) ? existing.status : status,
      data: { buyer_user_id: r.buyer_user_id, digital, transactions: (r.transactions || []).map((t) => ({ title: t.title, qty: t.quantity, listing_id: t.listing_id, variations: t.variations, personalization: t.personalization })), shipments: r.shipments, etsy_status: r.status },
      updated_at: new Date().toISOString() };
    await db.from('orders').upsert(row, { onConflict: 'external_id' });
    if (!existing) {
      added++;
      await db.from('ledger').upsert({ occurred_on: new Date(r.created_timestamp * 1000).toISOString().slice(0, 10), division: 'etsy', category: 'revenue',
        amount_usd: amount, basis: 'actual', source: 'etsy receipt', external_id: `etsy-rev:${r.receipt_id}` }, { onConflict: 'external_id' });
      // Etsy fees (6.5% transaction + ~3% + $0.25 payment processing) are estimates until the payment ledger is pulled.
      await db.from('ledger').upsert({ occurred_on: new Date(r.created_timestamp * 1000).toISOString().slice(0, 10), division: 'etsy', category: 'fees',
        amount_usd: Number((amount * 0.095 + 0.25).toFixed(2)), basis: 'estimated', source: 'Etsy published fee rates', external_id: `etsy-fee:${r.receipt_id}` }, { onConflict: 'external_id' });
    }
  }
  await setIntegration('etsy', 'Etsy', 'connected', `Orders synced ${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Chicago' })}`, null, 'etsy');
  if (added) await say('fulfillment', `${added} new Etsy order${added > 1 ? 's' : ''} received.`, 'success');
  return { added };
}
