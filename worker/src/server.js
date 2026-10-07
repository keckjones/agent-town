// Small web server inside the worker, for things outside services need to call back:
// SMS delivery receipts, payment webhooks, and the Etsy sign-in redirect. Every webhook is signature-checked.
import http from 'node:http';
import { config } from './config.js';
import { validTwilioSignature, applySmsStatus } from './lib/sms.js';
import { handleStripeWebhook } from './lib/stripe.js';
import { etsyAuthStart, etsyAuthCallback } from './lib/etsy.js';

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
