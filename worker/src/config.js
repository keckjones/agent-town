// All settings come from environment variables (set them in Railway → Variables).
// Nothing here reads files from your computer.

function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing environment variable ${name}. Add it in Railway → Variables.`);
  return v;
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  anthropicKey: required('ANTHROPIC_API_KEY'),

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

  googleApiKey: process.env.GOOGLE_API_KEY || '',

  // Your business identity. Required by law (CAN-SPAM) in every outreach email.
  business: {
    name: process.env.BUSINESS_NAME || '',
    senderName: process.env.SENDER_NAME || '',
    address: process.env.BUSINESS_ADDRESS || '',
    website: process.env.BUSINESS_WEBSITE || '',
    phone: process.env.BUSINESS_PHONE || '',
  },

  // Outreach email (fill these once your outreach domain + mailbox exist).
  smtp: {
    host: process.env.SMTP_HOST || '',           // Google Workspace: smtp.gmail.com
    port: Number(process.env.SMTP_PORT || 465),
    user: process.env.SMTP_USER || '',           // you@your-outreach-domain.com
    pass: process.env.SMTP_PASS || '',           // Google: an App Password
    from: process.env.SMTP_FROM || '',           // "Your Name <you@your-outreach-domain.com>"
  },

  // Optional: Shopify store for the Merchant agent to publish to (as drafts).
  shopify: {
    store: process.env.SHOPIFY_STORE || '',      // your-store.myshopify.com
    token: process.env.SHOPIFY_ADMIN_TOKEN || '',
  },

  managerCron: process.env.MANAGER_CRON || '0 */3 * * *', // every 3 hours
  pollSeconds: Number(process.env.POLL_SECONDS || 10),
  timezone: process.env.TZ || 'America/Chicago',
};

export const emailReady = () =>
  !!(config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from &&
     config.business.name && config.business.address);
