// Health check: `npm run check`. Tells you in plain words what's working and what isn't.
const results = [];
const ok = (m) => results.push(`  OK    ${m}`);
const bad = (m) => results.push(`  FIX   ${m}`);
const warn = (m) => results.push(`  LATER ${m}`);

try {
  const { config, emailReady } = await import('./config.js');
  ok('Required variables are set (Supabase + Anthropic)');
  const { db } = await import('./lib/db.js');

  for (const t of ['agents', 'tasks', 'events', 'prospects', 'approvals', 'documents', 'revenue', 'usage', 'settings', 'suppression']) {
    const { error } = await db.from(t).select('*', { head: true, count: 'exact' });
    error ? bad(`Table "${t}" missing. Run supabase/schema.sql in the Supabase SQL editor. (${error.message})`) : ok(`Table "${t}"`);
  }
  const { error: rpcErr } = await db.rpc('claim_next_task');
  rpcErr ? bad(`Queue function missing: ${rpcErr.message}`) : ok('Task queue function');
  const { error: bErr } = await db.storage.from('town-files').list('', { limit: 1 });
  bErr ? bad(`Storage bucket "town-files": ${bErr.message}`) : ok('File storage bucket');

  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  try {
    await new Anthropic({ apiKey: config.anthropicKey }).messages.create({ model: config.cheapModel, max_tokens: 5, messages: [{ role: 'user', content: 'hi' }] });
    ok(`Claude API (${config.cheapModel})`);
  } catch (e) { bad(`Claude API: ${e.message}`); }

  if (!config.googleApiKey) bad('GOOGLE_API_KEY not set (Scout and Inspector need it)');
  else {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': config.googleApiKey, 'X-Goog-FieldMask': 'places.id' },
      body: JSON.stringify({ textQuery: 'coffee in College Station, TX', pageSize: 1 }),
    });
    r.ok ? ok('Google Places API') : bad(`Google Places API (${r.status}). Enable "Places API (New)" in Google Cloud. ${(await r.text()).slice(0, 150)}`);
  }

  try {
    const { chromium } = await import('playwright');
    const b = await chromium.launch({ args: ['--no-sandbox'] }); await b.close();
    ok('Headless browser');
  } catch (e) { bad(`Headless browser: ${e.message.split('\n')[0]}`); }

  emailReady() ? ok('Outreach email settings') : warn('Outreach email not set up yet. Emails will wait in the approval inbox until you add SMTP_* and BUSINESS_* variables.');
  (config.shopify.store && config.shopify.token) ? ok('Shopify connected') : warn('No Shopify store connected (optional). Approved products are saved for you to copy.');
} catch (e) {
  bad(e.message);
}
console.log('\nAgent Town health check\n' + results.join('\n') + '\n');
process.exit(0);
