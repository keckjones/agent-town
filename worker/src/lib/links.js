// Everything the agents put online gets a row here: a link you can open, where it lives, and its numbers.
// Numbers come only from real sources: our own page counter, the YouTube API, the Etsy API, and orders.
// Accounts we can't read (Instagram/TikTok/Facebook without a connection) are marked "manual": you enter numbers.
import crypto from 'node:crypto';
import { db, say } from './db.js';
import { config } from '../config.js';

const now = () => new Date().toISOString();

/** Register (or update) a live link and announce it in the activity feed. Idempotent on URL. */
export async function recordLink(opts) {
  try { return await recordLinkInner(opts); } catch (e) { console.error('recordLink:', e.message); return null; }   // never block the real action
}
async function recordLinkInner({ url, title, kind, platform, whereItLives, analytics = 'auto', sourceType = null, sourceId = null, brandId = null, projectId = null, createdBy = 'manager' }) {
  if (!url) return null;
  const { data: existing } = await db.from('published_links').select('id').eq('url', url).maybeSingle();
  const row = { url, title: String(title).slice(0, 200), kind, platform, where_it_lives: whereItLives, analytics, source_type: sourceType, source_id: sourceId, brand_id: brandId, project_id: projectId, created_by: createdBy, status: 'live', updated_at: now() };
  const { data, error } = await db.from('published_links').upsert(row, { onConflict: 'url' }).select().single();
  if (error) { console.error('recordLink:', error.message); return null; }   // migration 009 not run yet: never block the real action
  if (!existing) await say(createdBy || 'manager', `Live now: ${row.title} (${whereItLives || platform}) ${url}`, 'success', { url, link_id: data.id, kind });
  return data;
}

/** Visitor counting for pages we host: a daily one-way hash; the raw IP is never stored. */
export function visitorHash(req) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  const day = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256').update(`${ip}|${req.headers['user-agent'] || ''}|${day}|${config.supabaseUrl}`).digest('hex').slice(0, 20);
}
export const isBot = (ua = '') => /bot|crawl|spider|slurp|preview|facebookexternalhit|embedly|whatsapp|discord|curl|wget|python|headless/i.test(ua);
export function refHost(req) {
  try { const r = req.headers.referer || req.headers.referrer; return r ? new URL(r).hostname.replace(/^www\./, '').slice(0, 60) : ''; } catch { return ''; }
}
/** Route every outbound link through /p/<slug>/go so we can count clicks on the call to action. */
export function withClickTracking(html, slug) {
  return html.replace(/href="((?:https?:|mailto:|tel:)[^"]+)"/gi, (_, u) => `href="/p/${encodeURIComponent(slug)}/go?u=${encodeURIComponent(u)}"`);
}

const sum = (rows, f) => rows.reduce((s, r) => s + Number(r[f] || 0), 0);

/** Refresh the numbers for every live link (hourly, and when you press Refresh). */
export async function refreshLinkMetrics() {
  const { data: links, error } = await db.from('published_links').select('*').eq('status', 'live').limit(500);
  if (error) return { refreshed: 0 };
  const today = new Date();
  const dayStr = (d) => new Date(today - d * 864e5).toISOString().slice(0, 10);
  let n = 0;
  for (const l of links || []) {
    let m = null;
    try {
      if (l.kind === 'page' && l.source_type === 'site') {
        const { data: v } = await db.from('site_visits').select('*').eq('site_id', l.source_id);
        const rows = v || [];
        const last = (d) => rows.filter((r) => r.day >= dayStr(d));
        const refs = {};
        for (const r of rows) for (const [k, c] of Object.entries(r.referrers || {})) refs[k] = (refs[k] || 0) + Number(c);
        m = { views_7d: sum(last(7), 'views'), visitors_7d: sum(last(7), 'visitors'), clicks_7d: sum(last(7), 'clicks'), views_30d: sum(last(30), 'views'), views_total: sum(rows, 'views'), clicks_total: sum(rows, 'clicks'),
          daily: Array.from({ length: 14 }, (_, i) => { const d = dayStr(13 - i); const r = rows.find((x) => x.day === d); return [d, r ? r.views : 0]; }),
          top_referrers: Object.entries(refs).sort((a, b) => b[1] - a[1]).slice(0, 5), source: 'our page counter' };
      } else if (l.kind === 'video' && l.source_type === 'content') {
        const { data: bm } = await db.from('brand_metrics').select('*').eq('content_id', l.source_id).order('observed_on', { ascending: false }).limit(8);
        if (bm?.length) m = { views: bm[0].views, likes: bm[0].likes, comments: bm[0].comments, views_7d_change: bm.length > 1 ? bm[0].views - bm[bm.length - 1].views : null, observed_on: bm[0].observed_on, source: 'YouTube API' };
      } else if (l.kind === 'account' && l.platform === 'youtube' && l.source_type === 'brand_account') {
        const { yt } = await import('./youtube.js');
        const ch = await yt(l.source_id, '/channels?part=statistics&mine=true');
        const st = ch.items?.[0]?.statistics || {};
        m = { followers: Number(st.subscriberCount || 0), views: Number(st.viewCount || 0), videos: Number(st.videoCount || 0), source: 'YouTube API' };
      } else if (l.kind === 'listing' && l.platform === 'etsy' && l.source_type === 'product') {
        const { data: prod } = await db.from('products').select('etsy_listing_id').eq('id', l.source_id).single();
        const { data: orders } = await db.from('orders').select('amount_usd, status').eq('product_id', l.source_id);
        m = { orders: (orders || []).length, revenue_usd: sum((orders || []).filter((o) => o.status !== 'refunded'), 'amount_usd'), source: 'Etsy orders' };
        if (prod?.etsy_listing_id) {
          const { etsyApi } = await import('./etsy.js');
          const li = await etsyApi(`/application/listings/${prod.etsy_listing_id}`).catch(() => null);
          if (li) Object.assign(m, { views: li.views ?? null, favorites: li.num_favorers ?? null, source: 'Etsy API + orders' });
        }
      } else if (l.kind === 'store_product' && l.source_type === 'ds_product') {
        const { data: p } = await db.from('ds_products').select('store_product_id').eq('id', l.source_id).single();
        const { data: orders } = await db.from('orders').select('amount_usd, status, data').eq('division', 'dropship');
        const mine = (orders || []).filter((o) => p?.store_product_id && JSON.stringify(o.data || {}).includes(String(p.store_product_id)));
        m = { orders: mine.length, revenue_usd: sum(mine.filter((o) => o.status !== 'refunded'), 'amount_usd'), source: 'Shopify orders' };
      }
    } catch (e) { m = { ...(l.metrics || {}), error: String(e.message).slice(0, 160) }; }
    if (m) { await db.from('published_links').update({ metrics: m, metrics_updated_at: now() }).eq('id', l.id); n++; }
  }
  return { refreshed: n };
}
