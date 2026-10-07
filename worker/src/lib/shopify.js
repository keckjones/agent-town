// Shopify storefront for the dropshipping division: products, order data, fulfillment status, verified webhooks.
import crypto from 'node:crypto';
import { config } from '../config.js';
import { retryable } from './actions.js';

const ver = () => process.env.SHOPIFY_API_VERSION || '2025-07';
export const shopifyReady = () => !!(config.shopify.store && config.shopify.token);

export async function shopify(path, { method = 'GET', json } = {}) {
  if (!shopifyReady()) throw retryable(new Error('Shopify is not connected: add SHOPIFY_STORE and SHOPIFY_ADMIN_TOKEN in Railway.'));
  const res = await fetch(`https://${config.shopify.store}/admin/api/${ver()}${path}`, {
    method, headers: { 'X-Shopify-Access-Token': config.shopify.token, 'Content-Type': 'application/json' },
    body: json ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429) throw retryable(new Error('Shopify rate limit; retrying later.'));
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`Shopify ${res.status}: ${JSON.stringify(j.errors || j).slice(0, 200)}`);
    if (res.status >= 400 && res.status < 500) retryable(err);
    throw err;
  }
  return j;
}

export function validShopifyWebhook(raw, hmacHeader) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret || !hmacHeader) return false;
  const digest = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const a = Buffer.from(digest), b = Buffer.from(hmacHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Revenue we keep: items after discounts + shipping charged. Sales tax is collected for the state, not revenue. */
export function orderRevenue(o) {
  const items = Number(o.current_subtotal_price ?? o.subtotal_price ?? 0);
  const ship = (o.shipping_lines || []).reduce((s, l) => s + Number(l.discounted_price ?? l.price ?? 0), 0);
  return { revenue: +(items + ship).toFixed(2), tax: Number(o.current_total_tax ?? o.total_tax ?? 0) };
}
