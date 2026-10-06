// Carries out whatever you approved in the dashboard's approval inbox.
import { config, emailReady } from './config.js';
import { db, say, download, countToday, getSettings } from './lib/db.js';
import { sendMail } from './lib/mailer.js';

async function finish(id, status, result) {
  await db.from('approvals').update({ status, result, executed_at: new Date().toISOString() }).eq('id', id);
}

const executors = {
  async email(a) {
    const { to, subject, body, attachment } = a.payload;
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
      return finish(a.id, 'held', { note: 'No valid email address. Add one in the dashboard, or call them instead.' });
    }
    if (!emailReady()) {
      // Leave it approved; it goes out automatically once the outreach mailbox is configured.
      if (!a.result?.waiting) await db.from('approvals').update({ result: { waiting: 'Outreach email not set up yet. Will send once SMTP settings are added.' } }).eq('id', a.id);
      return;
    }
    const { data: blocked } = await db.from('suppression').select('email').eq('email', to.toLowerCase()).maybeSingle();
    if (blocked) return finish(a.id, 'rejected', { note: 'Address is on the do-not-contact list.' });

    const settings = await getSettings();
    const sentToday = await countToday('events', (q) => q.eq('agent_id', 'postmaster').eq('level', 'success').like('message', 'Sent:%'));
    if (sentToday >= settings.daily_email_cap) return; // try again tomorrow

    const attachments = attachment ? [{ filename: 'new-homepage-concept.jpg', content: await download(attachment) }] : [];
    const info = await sendMail({ to, subject, text: body, attachments });
    await finish(a.id, 'executed', { message_id: info.messageId });
    if (a.prospect_id) await db.from('prospects').update({ stage: 'contacted', updated_at: new Date().toISOString() }).eq('id', a.prospect_id);
    await say('postmaster', `Sent: letter to ${to}`, 'success');
  },

  async product(a) {
    if (!config.shopify.store || !config.shopify.token) {
      return finish(a.id, 'executed', { manual: true, note: 'Approved. No store connected yet, so copy this listing into your shop.' });
    }
    const p = a.payload;
    const res = await fetch(`https://${config.shopify.store}/admin/api/2024-10/products.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': config.shopify.token },
      body: JSON.stringify({ product: {
        title: p.title, body_html: p.description, tags: (p.tags || []).join(', '), status: 'draft',
        variants: [{ price: String(p.price_usd), requires_shipping: false }],
      } }),
    });
    if (!res.ok) throw new Error(`Shopify error ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const j = await res.json();
    await finish(a.id, 'executed', { shopify_product_id: j.product?.id, note: 'Created as a DRAFT in Shopify. Add the file/images and publish.' });
    await say('merchant', `"${p.title}" is now a draft in your Shopify store.`, 'success');
  },

  async social_post(a) {
    // No posting platform connected yet: approved posts are ready to copy from the dashboard.
    await finish(a.id, 'executed', { manual: true, note: 'Approved. Copy it from the dashboard and post it.' });
  },

  async campaign(a) {
    await finish(a.id, 'executed', { note: 'Approved.' });
  },
};

export async function runApprovals() {
  const { data, error } = await db.from('approvals').select('*').eq('status', 'approved').order('decided_at').limit(20);
  if (error) throw new Error(error.message);
  for (const a of data || []) {
    const fn = executors[a.kind];
    if (!fn) { await finish(a.id, 'failed', { error: `No executor for ${a.kind}` }); continue; }
    try { await fn(a); }
    catch (e) {
      await finish(a.id, 'failed', { error: e.message });
      await say(a.agent_id || 'manager', `Could not complete "${a.title}": ${e.message}`, 'error');
    }
  }
}
