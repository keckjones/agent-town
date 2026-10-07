// Stripe: payment links for approved invoices, and a verified webhook that records real payments.
import crypto from 'node:crypto';
import { config, stripeReady } from '../config.js';
import { db, addLedger, say } from './db.js';
import { retryable } from './actions.js';

async function stripe(path, form) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: form ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${config.stripe.secretKey}`, ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams(form) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  if (!res.ok) {
    const err = new Error(`Stripe: ${j.error?.message || res.status}`);
    if (res.status >= 400 && res.status < 500) retryable(err);
    throw err;
  }
  return j;
}

/** Create a one-time payment link for an invoice. Call inside runOnce(). */
export async function createPaymentLink(invoice, description) {
  if (!stripeReady()) throw retryable(new Error('Stripe is not connected: add STRIPE_SECRET_KEY in Railway.'));
  const price = await stripe('prices', {
    currency: 'usd', unit_amount: String(Math.round(Number(invoice.amount_usd) * 100)),
    'product_data[name]': description.slice(0, 250),
  });
  const link = await stripe('payment_links', {
    'line_items[0][price]': price.id, 'line_items[0][quantity]': '1',
    'metadata[invoice_id]': String(invoice.id),
    'restrictions[completed_sessions][limit]': '1',
  });
  return { id: link.id, url: link.url };
}

function verify(raw, header) {
  if (!config.stripe.webhookSecret || !header) return false;
  const parts = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > 300) return false;
  const expected = crypto.createHmac('sha256', config.stripe.webhookSecret).update(`${t}.${raw.toString('utf-8')}`).digest('hex');
  const sigs = header.split(',').filter((p) => p.startsWith('v1=')).map((p) => p.slice(3));
  return sigs.some((s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected)));
}

export async function handleStripeWebhook(raw, signature) {
  if (!verify(raw, signature)) return { status: 400, body: 'bad signature' };
  const event = JSON.parse(raw.toString('utf-8'));
  if (event.type === 'checkout.session.completed' && event.data?.object?.payment_status === 'paid') {
    const s = event.data.object;
    const { data: inv } = await db.from('invoices').select('*').eq('provider_id', s.payment_link).maybeSingle();
    const amount = Number(s.amount_total || 0) / 100;
    await addLedger({ division: 'agency', category: 'revenue', amountUsd: amount, basis: 'actual', source: 'stripe', externalId: `stripe:${s.id}`,
      note: inv ? `Invoice #${inv.id}` : 'Stripe payment' });
    // Card fees are not in this event; recorded as an estimate (2.9% + $0.30).
    await addLedger({ division: 'agency', category: 'fees', amountUsd: Number((amount * 0.029 + 0.3).toFixed(2)), basis: 'estimated',
      source: 'stripe standard pricing', externalId: `stripe-fee:${s.id}` });
    if (inv) {
      await db.from('invoices').update({ status: 'paid', paid_at: new Date().toISOString() }).eq('id', inv.id);
      if (inv.project_id) {
        const { data: proj } = await db.from('projects').select('status').eq('id', inv.project_id).single();
        if (proj && ['awaiting_payment', 'awaiting_signature', 'proposal'].includes(proj.status)) {
          await db.from('projects').update({ status: 'onboarding', updated_at: new Date().toISOString() }).eq('id', inv.project_id);
        }
      }
      await say('finance', `Payment received: $${amount.toFixed(2)} for invoice #${inv.id}.`, 'success');
    }
  }
  if (event.type === 'charge.refunded') {
    const c = event.data.object;
    await addLedger({ division: 'agency', category: 'refund', amountUsd: Number(c.amount_refunded || 0) / 100, basis: 'actual', source: 'stripe', externalId: `stripe-refund:${c.id}` });
  }
  return { status: 200, body: 'ok' };
}
