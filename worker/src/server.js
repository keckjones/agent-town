// Small web server inside the worker, for things outside services need to call back:
// SMS delivery receipts, payment webhooks, and the Etsy sign-in redirect. Every webhook is signature-checked.
import { gmailCallback } from './lib/gmail.js';
import http from 'node:http';
import { config } from './config.js';
import { validTwilioSignature, applySmsStatus } from './lib/sms.js';
import { handleStripeWebhook } from './lib/stripe.js';
import { etsyAuthStart, etsyAuthCallback } from './lib/etsy.js';
import { validShopifyWebhook, orderRevenue } from './lib/shopify.js';
import { db, addLedger, enqueue } from './lib/db.js';
import { youtubeCallback } from './lib/youtube.js';

function readBody(req, limit = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

const page = (title, msg) => `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><body style="font:16px system-ui;background:#0b0f17;color:#e8edf5;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px">
<div style="max-width:460px"><h1 style="font-size:20px">${title}</h1><p>${msg}</p></div>`;

export function startServer() {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    try {
      if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, 'ok');

      if (req.method === 'POST' && url.pathname === '/webhooks/twilio/status') {
        const raw = (await readBody(req)).toString('utf-8');
        const params = Object.fromEntries(new URLSearchParams(raw));
        const fullUrl = `${config.publicUrl}${url.pathname}`;
        if (!validTwilioSignature(fullUrl, params, req.headers['x-twilio-signature'])) return send(res, 403, 'bad signature');
        await applySmsStatus(params.MessageSid, params.MessageStatus, params.ErrorCode || null);
        return send(res, 204, '');
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/stripe') {
        const raw = await readBody(req);
        const out = await handleStripeWebhook(raw, req.headers['stripe-signature']);
        return send(res, out.status, out.body);
      }

      if (req.method === 'POST' && url.pathname === '/webhooks/shopify') {
        const raw = await readBody(req);
        if (!validShopifyWebhook(raw, req.headers['x-shopify-hmac-sha256'])) return send(res, 401, 'bad signature');
        const topic = req.headers['x-shopify-topic'];
        const o = JSON.parse(raw.toString('utf-8'));
        if (topic === 'orders/paid') {
          const { revenue, tax } = orderRevenue(o);
          const ext = `shopify:${o.id}`;
          const { data: existing } = await db.from('orders').select('id').eq('external_id', ext).maybeSingle();
          if (!existing) {
            const { data: row } = await db.from('orders').insert({ division: 'dropship', platform: 'shopify', external_id: ext, amount_usd: revenue, status: 'new',
              data: { line_items: (o.line_items || []).map((l) => ({ product_id: l.product_id, variant_id: l.variant_id, quantity: l.quantity, title: l.title, sku: l.sku })),
                shipping_address: o.shipping_address && { address1: o.shipping_address.address1, city: o.shipping_address.city, province: o.shipping_address.province_code, zip: o.shipping_address.zip, country_code: o.shipping_address.country_code },
                billing_address: o.billing_address && { country_code: o.billing_address.country_code }, financial_status: o.financial_status, tax_collected: tax, order_number: o.order_number } }).select().single();
            await addLedger({ division: 'dropship', category: 'revenue', amountUsd: revenue, basis: 'actual', source: 'shopify order (excl. sales tax)', externalId: `shopify-rev:${o.id}` });
            await addLedger({ division: 'dropship', category: 'fees', amountUsd: +(revenue * 0.029 + 0.3).toFixed(2), basis: 'estimated', source: 'card processing estimate', externalId: `shopify-fee:${o.id}` });
            await enqueue('ds_orders', 'review_order', { order_id: row.id }, { createdBy: 'shopify', priority: 2 });
          }
        }
        if (topic === 'refunds/create') {
          const amt = (o.transactions || []).filter((t) => t.kind === 'refund' && t.status === 'success').reduce((s, t) => s + Number(t.amount), 0);
          if (amt) await addLedger({ division: 'dropship', category: 'refund', amountUsd: amt, basis: 'actual', source: 'shopify refund', externalId: `shopify-refund:${o.id}` });
          await db.from('orders').update({ status: 'refunded', updated_at: new Date().toISOString() }).eq('external_id', `shopify:${o.order_id}`);
        }
        return send(res, 200, 'ok');
      }

      if (req.method === 'GET' && url.pathname === '/oauth/youtube/callback') {
        const r = await youtubeCallback(url.searchParams);
        return send(res, r.ok ? 200 : 400, page(r.ok ? 'YouTube connected' : 'YouTube not connected', r.message), 'text/html');
      }

      if (req.method === 'GET' && url.pathname === '/oauth/gmail/callback') {
        const r = await gmailCallback(url.searchParams);
        return send(res, r.ok ? 200 : 400, page(r.ok ? 'Gmail connected' : 'Gmail not connected', r.message), 'text/html');
      }

      if (req.method === 'GET' && url.pathname === '/oauth/etsy/start') {
        const location = await etsyAuthStart();
        res.writeHead(302, { Location: location }); return res.end();
      }
      if (req.method === 'GET' && url.pathname === '/oauth/etsy/callback') {
        const r = await etsyAuthCallback(url.searchParams);
        return send(res, r.ok ? 200 : 400, page(r.ok ? 'Etsy connected' : 'Etsy not connected', r.message), 'text/html');
      }

      return send(res, 404, 'not found');
    } catch (e) {
      console.error('HTTP error', url.pathname, e.message);
      return send(res, 500, 'error');
    }
  });
  server.listen(config.port, () => console.log(`Webhook server listening on :${config.port}${config.publicUrl ? ` (${config.publicUrl})` : ' (no public URL yet)'}`));
  return server;
}
