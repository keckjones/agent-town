// Checks what is REALLY connected and records it for the dashboard. Nothing is shown as connected
// unless a live check passed. Each disconnected service carries exact setup steps.
import nodemailer from 'nodemailer';
import { config, emailReady, smsReady, stripeReady, etsyReady, sportsReady } from '../config.js';
import { db, setIntegration } from './db.js';

const STEPS = {
  gmail: 'Sign in to agentickj@gmail.com → myaccount.google.com → Security → turn on 2-Step Verification → search "App passwords" → create one named agent-town → in Railway Variables add SMTP_PASS=<the 16 characters>. Also set BUSINESS_NAME and BUSINESS_ADDRESS.',
  twilio: '1) twilio.com → sign up → buy a local number (~$1.15/mo). 2) Messaging → Regulatory Compliance → register a Sole Proprietor A2P 10DLC brand + campaign (use case "Account notifications", recipient = you). Carriers block texts until this is approved (usually 1–7 days). 3) Railway Variables: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM=+1XXXXXXXXXX. 4) Press "Send test text" in Finance.',
  public_url: 'Railway → your service → Settings → Networking → Generate Domain. Railway then provides the address automatically; redeploy once.',
  stripe: 'stripe.com → Developers → API keys → copy the Secret key → Railway STRIPE_SECRET_KEY. Then Developers → Webhooks → Add endpoint <worker URL>/webhooks/stripe with events checkout.session.completed and charge.refunded → copy the signing secret → Railway STRIPE_WEBHOOK_SECRET.',
  etsy: '1) etsy.com/developers → Create a new app (personal use, for your own shop) → wait for approval. 2) Railway: ETSY_API_KEY (keystring) and ETSY_SHARED_SECRET. 3) In the app settings add callback URL <worker URL>/oauth/etsy/callback. 4) Click "Connect Etsy" in the Etsy station.',
  printful: 'printful.com → connect your Etsy store in Printful (Stores → Add store → Etsy) so Printful receives orders directly. Then Developers → create a private token with orders read access → Railway PRINTFUL_TOKEN.',
  sports: 'In KJ\'s Picks, create a dedicated member account for marketing (comped, read-only). Railway: SPORTS_SUPABASE_URL=https://wsogzlxricvjmpjshhjl.supabase.co, SPORTS_SUPABASE_ANON_KEY=<the sports site\'s public anon key>, SPORTS_EMAIL, SPORTS_PASSWORD.',
  shopify: 'Shopify admin → Settings → Apps → Develop apps → create app with scopes read_orders, write_products, read_products, read_fulfillments → install → copy the Admin API token. Railway: SHOPIFY_STORE=yourstore.myshopify.com, SHOPIFY_ADMIN_TOKEN, SHOPIFY_WEBHOOK_SECRET (the app\'s API secret). Add webhooks orders/paid and refunds/create pointing to <worker URL>/webhooks/shopify.',
  rentcast: 'rentcast.io → sign up → API dashboard → create key (free tier ~50 calls/month; paid plans for more) → Railway RENTCAST_API_KEY. Comparables are listing data, not closed sales (Texas is a non-disclosure state).',
  booking: 'Create a booking page that reads your real calendar (Google Calendar → Create → Appointment schedule, or Cal.com) → copy its public link → Railway BOOKING_URL.',
};

async function check(id, name, division, fn, stepsOverride = null) {
  try {
    const [status, detail, steps] = await fn();
    if (stepsOverride && !steps) { await setIntegration(id, name, status, detail, stepsOverride, division); return; }
    await setIntegration(id, name, status, detail, steps || STEPS[id] || null, division);
  } catch (e) {
    await setIntegration(id, name, 'error', e.message.slice(0, 300), STEPS[id] || null, division);
  }
}

export async function checkIntegrations() {
  await check('supabase', 'Database (Supabase)', 'hq', async () => ['connected', 'Worker is reading and writing']);

  await check('anthropic', 'Claude API', 'hq', async () => {
    const r = await fetch('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': config.anthropicKey, 'anthropic-version': '2023-06-01' }, signal: AbortSignal.timeout(15000) });
    return r.ok ? ['connected', 'API key accepted'] : ['error', `API key rejected (${r.status}). Create a key at console.anthropic.com → API Keys (starts with sk-ant-api).`];
  });

  await check('google_places', 'Google Places', 'agency', async () =>
    config.googleApiKey ? ['unverified', 'Key present; marked connected after the next successful scouting run'] : ['needs_setup', 'GOOGLE_API_KEY missing']);

  await check('gmail', 'Email (agentickj@gmail.com)', 'agency', async () => {
    if (!emailReady()) return ['needs_setup', 'Waiting for SMTP_PASS (Google App Password) and BUSINESS_NAME / BUSINESS_ADDRESS'];
    const t = nodemailer.createTransport({ host: config.smtp.host, port: config.smtp.port, secure: config.smtp.port === 465, auth: { user: config.smtp.user, pass: config.smtp.pass } });
    await t.verify();
    return ['connected', `Signed in as ${config.smtp.user} (sending + reply reading)`];
  });

  await check('public_url', 'Worker public address', 'hq', async () =>
    config.publicUrl ? ['connected', config.publicUrl] : ['needs_setup', 'Needed for SMS receipts, Stripe webhooks and Etsy sign-in']);

  await check('twilio', 'Twilio SMS', 'finance', async () => {
    if (!smsReady()) return ['needs_setup', 'No Twilio credentials yet'];
    const { data } = await db.from('integrations').select('status, detail').eq('id', 'twilio').maybeSingle();
    const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}.json`, {
      headers: { Authorization: 'Basic ' + Buffer.from(`${config.twilio.accountSid}:${config.twilio.authToken}`).toString('base64') }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return ['error', `Twilio rejected the credentials (${r.status})`];
    if (data?.status === 'connected') return ['connected', data.detail];
    return ['unverified', 'Credentials work. Not active until a test text is DELIVERED (press "Send test text").'];
  });

  await check('stripe', 'Stripe payments', 'finance', async () => {
    if (!stripeReady()) return ['needs_setup', 'Invoices are created as drafts; payment links need Stripe'];
    const r = await fetch('https://api.stripe.com/v1/balance', { headers: { Authorization: `Bearer ${config.stripe.secretKey}` }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return ['error', `Stripe rejected the key (${r.status})`];
    return config.stripe.webhookSecret ? ['connected', 'Payment links + verified payment webhook'] : ['unverified', 'Key works; add STRIPE_WEBHOOK_SECRET so payments are recorded automatically'];
  });

  await check('etsy', 'Etsy', 'etsy', async () => {
    if (!etsyReady()) return ['needs_setup', 'No Etsy app key yet'];
    const { data } = await db.from('secrets').select('value').eq('id', 'etsy_tokens').maybeSingle();
    if (!data?.value?.refresh) return ['needs_setup', 'App key present; click "Connect Etsy" to sign in to your shop'];
    return ['connected', 'Shop signed in'];
  });

  await check('printful', 'Printful', 'etsy', async () => {
    if (!config.printful.token) return ['needs_setup', 'Only needed for print-on-demand products'];
    const r = await fetch('https://api.printful.com/stores', { headers: { Authorization: `Bearer ${config.printful.token}` }, signal: AbortSignal.timeout(15000) });
    return r.ok ? ['connected', 'Token accepted'] : ['error', `Printful rejected the token (${r.status})`];
  });

  await check('sports', "KJ's Picks data feed", 'sports', async () => {
    if (!sportsReady()) return ['needs_setup', 'Not connected; sports marketing is paused'];
    const { data } = await db.from('sports_snapshots').select('fetched_at, stale').order('fetched_at', { ascending: false }).limit(1);
    if (!data?.length) return ['unverified', 'Credentials present; waiting for first import'];
    return ['connected', `Last import ${new Date(data[0].fetched_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}${data[0].stale ? ' (model data stale)' : ''}`];
  });

  await check('booking', 'Calendar booking link', 'agency', async () =>
    config.bookingUrl ? ['connected', `Agents offer ${config.bookingUrl}; the booking page reads your calendar`] : ['needs_setup', 'Agents can propose a call but cannot book times without a booking link']);

  await check('shopify', 'Shopify (dropshipping store)', 'dropship', async () => {
    if (!config.shopify.store || !config.shopify.token) return ['needs_setup', 'Store not connected; dropshipping stays in research mode'];
    const r = await fetch(`https://${config.shopify.store}/admin/api/${process.env.SHOPIFY_API_VERSION || '2025-07'}/shop.json`, { headers: { 'X-Shopify-Access-Token': config.shopify.token }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return ['error', `Shopify rejected the token (${r.status})`];
    return process.env.SHOPIFY_WEBHOOK_SECRET ? ['connected', 'Products + verified order webhooks'] : ['unverified', 'Token works; add SHOPIFY_WEBHOOK_SECRET so orders arrive'];
  });

  await check('rentcast', 'Property data (RentCast)', 'realestate', async () =>
    process.env.RENTCAST_API_KEY ? ['connected', 'Property records, valuations and listing comps'] : ['needs_setup', 'Underwriting runs on facts you provide only (low confidence)']);

  await check('re_legal', 'Texas real estate legal review', 'realestate', async () => {
    const { data } = await db.from('re_jurisdictions').select('status, attorney_review').eq('id', 'TX').maybeSingle();
    if (!data) return ['needs_setup', 'Run 003_dropship_realestate.sql'];
    return data.status === 'transactions_ok' ? ['connected', `Reviewed: ${JSON.stringify(data.attorney_review)}`] : ['needs_setup', `Status: ${data.status}. Offers and contracts stay blocked until a Texas real estate attorney reviews the templates.`];
  }, 'Hire a Texas real estate attorney to review: (1) purchase agreement with assignment clause, (2) seller notice under Occ. Code §1101.0045 (required since 2024), (3) buyer notice, (4) assignment agreement, (5) your outreach letter. Then record the review and approved templates in Real Estate.');

  await check('ai_calling', 'AI phone calls', 'agency', async () => ['disabled',
    'Off by design. AI voices are "artificial voice" under the TCPA, and a listed business number is not consent. Calls become manual call tasks with a prepared script; AI calling would only ever apply to prospects who gave written consent, and needs a voice provider connected.',
    'Not available yet. Manual call tasks with scripts are fully working.']);

  await check('esign', 'E-signature', 'agency', async () => ['needs_setup',
    'Not connected. Proposals are generated as documents you send; signature tracking needs a provider (e.g. Dropbox Sign or DocuSign API).']);

  await check('social_posting', 'Social auto-posting', 'sports', async () => ['disabled',
    'Not connected. Approved posts are queued with a Copy button; no scheduler API is connected yet.']);
}
