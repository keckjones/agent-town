// All settings come from environment variables (set them in Railway → Variables).
// Nothing here reads files from your computer.

// Clean up common paste mistakes: surrounding spaces or quotes.
function clean(v) {
  if (!v) return '';
  return v.trim().replace(/^["']|["']$/g, '').trim();
}

function required(name) {
  const v = clean(process.env[name]);
  if (!v) throw new Error(`Missing environment variable ${name}. Add it in Railway → Variables.`);
  return v;
}

// Accepts the URL with or without /rest/v1/, extra spaces, or other text on the same line.
function supabaseUrl() {
  const raw = required('SUPABASE_URL');
  const m = raw.match(/https:\/\/[a-z0-9-]+\.supabase\.(co|in)/i);
  if (!m) {
    throw new Error(`SUPABASE_URL doesn't look right. It should be exactly like https://yourproject.supabase.co ` +
      `(it currently starts with "${raw.slice(0, 30)}" and is ${raw.length} characters long).`);
  }
  return m[0];
}

// Keys never contain spaces; take the first word in case other text got pasted on the same line.
const key = (name) => required(name).split(/\s+/)[0];
const opt = (name) => clean(process.env[name]).split(/\s+/)[0] || '';

export const config = {
  supabaseUrl: supabaseUrl(),
  supabaseServiceKey: key('SUPABASE_SERVICE_ROLE_KEY'),
  anthropicKey: key('ANTHROPIC_API_KEY'),

  // Model choices. Fast/cheap model for routine work, stronger model for planning & design.
  model: process.env.CLAUDE_MODEL || 'claude-sonnet-5-5',
  cheapModel: process.env.CLAUDE_CHEAP_MODEL || 'claude-haiku-4-5-20251001',
  // USD per million tokens, used to track spend. Check current prices at
  // https://www.anthropic.com/pricing and update if they differ.
  prices: {
    'claude-sonnet-5-5': { in: Number(process.env.PRICE_SONNET_IN || 3), out: Number(process.env.PRICE_SONNET_OUT || 15) },
    'claude-haiku-4-5-20251001': { in: Number(process.env.PRICE_HAIKU_IN || 1), out: Number(process.env.PRICE_HAIKU_OUT || 5) },
    default: { in: 5, out: 25 },
  },
  webSearchPrice: 0.01, // $10 per 1,000 searches

  googleApiKey: clean(process.env.GOOGLE_API_KEY).split(/\s+/)[0],

  // Your business identity. Required by law (CAN-SPAM) in every outreach email.
  business: {
    name: clean(process.env.BUSINESS_NAME),
    senderName: clean(process.env.SENDER_NAME),
    address: clean(process.env.BUSINESS_ADDRESS),
    website: clean(process.env.BUSINESS_WEBSITE),
    phone: clean(process.env.BUSINESS_PHONE),
    // Public contact address shown in every message and used for replies.
    email: clean(process.env.BUSINESS_EMAIL) || 'agentickj@gmail.com',
  },

  // Sending mailbox. Defaults to the Gmail account agentickj@gmail.com;
  // only SMTP_PASS (a Google App Password) has to be added in Railway.
  smtp: {
    host: clean(process.env.SMTP_HOST) || 'smtp.gmail.com',
    port: Number(clean(process.env.SMTP_PORT) || 465),
    user: clean(process.env.SMTP_USER) || 'agentickj@gmail.com',
    // Google shows app passwords in groups of four ("abcd efgh ..."); spaces are removed.
    pass: clean(process.env.SMTP_PASS).replace(/\s+/g, ''),
    from: clean(process.env.SMTP_FROM) || '',
  },
  // Reading replies from the same mailbox (Gmail IMAP uses the same App Password).
  imap: {
    host: clean(process.env.IMAP_HOST) || 'imap.gmail.com',
    port: Number(clean(process.env.IMAP_PORT) || 993),
  },

  // Optional: Shopify store for the Merchant agent to publish to (as drafts).
  shopify: {
    store: process.env.SHOPIFY_STORE || '',      // your-store.myshopify.com
    token: process.env.SHOPIFY_ADMIN_TOKEN || '',
  },

  // Public address of this worker (for SMS delivery callbacks, Etsy sign-in, payment webhooks).
  // Railway sets RAILWAY_PUBLIC_DOMAIN automatically once you click "Generate Domain".
  publicUrl: (clean(process.env.PUBLIC_URL) || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')).replace(/\/$/, ''),
  port: Number(process.env.PORT || 8080),
  dashboardUrl: clean(process.env.DASHBOARD_URL),

  // Morning text + alerts (Twilio).
  twilio: {
    accountSid: opt('TWILIO_ACCOUNT_SID'),
    authToken: opt('TWILIO_AUTH_TOKEN'),
    from: opt('TWILIO_FROM'),                         // your Twilio number, e.g. +19795550123
    messagingServiceSid: opt('TWILIO_MESSAGING_SERVICE_SID'),
  },

  // Invoices and payment links.
  stripe: { secretKey: opt('STRIPE_SECRET_KEY'), webhookSecret: opt('STRIPE_WEBHOOK_SECRET') },

  // Etsy Open API v3 (your own shop).
  etsy: { apiKey: opt('ETSY_API_KEY'), sharedSecret: opt('ETSY_SHARED_SECRET') },
  printful: { token: opt('PRINTFUL_TOKEN') },

  // KJ's Picks (the sports project). Read-only. A dedicated member login is the safest option.
  sports: {
    supabaseUrl: clean(process.env.SPORTS_SUPABASE_URL),
    anonKey: opt('SPORTS_SUPABASE_ANON_KEY'),
    email: clean(process.env.SPORTS_EMAIL),
    password: clean(process.env.SPORTS_PASSWORD),
    siteUrl: clean(process.env.SPORTS_SITE_URL) || 'https://keckjones.github.io/cfb-edge/',
  },

  // Meetings: a booking link with your real availability (Google Calendar appointment page, Cal.com, Calendly).
  bookingUrl: clean(process.env.BOOKING_URL),

  managerCron: process.env.MANAGER_CRON || '0 */3 * * *', // every 3 hours
  pollSeconds: Number(process.env.POLL_SECONDS || 10),
  timezone: process.env.TZ || 'America/Chicago',
};

if (!config.smtp.from) {
  const who = config.business.senderName || config.business.name;
  config.smtp.from = who ? `${who} <${config.smtp.user}>` : config.smtp.user;
}

export const emailReady = () =>
  !!(config.smtp.host && config.smtp.user && config.smtp.pass &&
     config.business.name && config.business.address);

export const smsReady = () => !!(config.twilio.accountSid && config.twilio.authToken && (config.twilio.from || config.twilio.messagingServiceSid));
export const stripeReady = () => !!config.stripe.secretKey;
export const etsyReady = () => !!config.etsy.apiKey;
export const sportsReady = () => !!(config.sports.supabaseUrl && config.sports.anonKey && config.sports.email && config.sports.password);
