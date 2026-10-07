// Carries out what you approved. Before anything runs, it re-checks that:
//  - the approval is still "approved" and the content is exactly what you approved (hash match),
//  - it hasn't expired, and the town isn't paused.
// Every external action is keyed, so a retry can never send, charge, or publish twice.
import { config } from './config.js';
import { db, must, say, addLedger } from './lib/db.js';
import { sendMail, legalFooter } from './lib/mailer.js';
import { runOnce, AlreadyAttempted } from './lib/actions.js';
import { createAuthorityFromApproval } from './lib/authority.js';
import { createPaymentLink } from './lib/stripe.js';
import { sendOutreach } from './agents/postmaster.js';
import { publishProduct } from './agents/etsy.js';
import { launchDropshipProduct } from './agents/dropship.js';
import { executeRealEstate } from './agents/realestate.js';
import { executeMedia } from './agents/media.js';
import { findWorkflow, advance, logEvent } from './lib/workflows.js';

async function finish(id, status, result) {
  await db.from('approvals').update({ status, result, executed_at: new Date().toISOString() }).eq('id', id);
}

const executors = {
  async email(a) {
    const p = a.prospect_id ? must(await db.from('prospects').select('*').eq('id', a.prospect_id).single()) : null;
    const { to, subject, body, attachment } = a.payload;
    if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return finish(a.id, 'held', { note: 'No valid email address. Add one, or use the call script instead.' });
    if (p) {
      if (to.toLowerCase() !== (p.email || '').toLowerCase()) await db.from('prospects').update({ email: to }).eq('id', p.id);
      await sendOutreach({ ...p, email: to }, { kind: 'initial', subject, body, attachment, key: `email:prospect:${p.id}:initial` });
    } else {
      await runOnce(`email:approval:${a.id}`, 'email', () => sendMail({ to, subject, text: body }));
    }
    await finish(a.id, 'executed', { sent_to: to });
  },

  async followup(a) {
    const p = must(await db.from('prospects').select('*').eq('id', a.prospect_id).single());
    await sendOutreach(p, { kind: 'followup', subject: a.payload.subject, body: a.payload.body, inReplyTo: a.payload.in_reply_to,
      key: `email:prospect:${p.id}:followup${a.payload.followup_number}` });
    await finish(a.id, 'executed', { sent_to: p.email });
  },

  async reply(a) {
    const { to, subject, body, in_reply_to, conversation_id } = a.payload;
    const { result } = await runOnce(`email:approval:${a.id}`, 'email', async () => {
      const info = await sendMail({ to, subject, text: body, inReplyTo: in_reply_to });
      return { message_id: info.messageId };
    });
    if (conversation_id) {
      await db.from('messages').insert({ conversation_id, direction: 'out', channel: 'email', sender: config.smtp.user, subject, body, external_id: result?.message_id || null });
      await db.from('conversations').update({ status: 'waiting_on_customer', last_message_at: new Date().toISOString() }).eq('id', conversation_id);
    }
    if (a.prospect_id) await db.from('outreach_messages').insert({ prospect_id: a.prospect_id, direction: 'out', kind: 'reply', to_address: to, subject, body, message_id: result?.message_id, in_reply_to, status: 'sent', action_key: `email:approval:${a.id}` }).then(() => {}, () => {});
    await finish(a.id, 'executed', { sent_to: to });
  },

  async proposal(a) {
    const p = must(await db.from('prospects').select('*').eq('id', a.prospect_id).single());
    const pl = a.payload;
    // Customer + project + invoice exist exactly once per approval.
    let { data: cust } = await db.from('customers').select('*').eq('email', pl.to.toLowerCase()).maybeSingle();
    if (!cust) cust = must(await db.from('customers').insert({ name: p.name, email: pl.to.toLowerCase(), phone: p.phone, company: p.name, prospect_id: p.id, division: 'agency' }).select().single());
    let { data: proj } = await db.from('projects').select('*').eq('prospect_id', p.id).neq('status', 'cancelled').maybeSingle();
    if (!proj) proj = must(await db.from('projects').insert({ customer_id: cust.id, prospect_id: p.id, title: `${p.name} website`, price_usd: pl.price_usd,
      scope: { deliverables: pl.deliverables, not_included: pl.not_included, customer_provides: pl.customer_provides, timeline_days: pl.timeline_days, care_plan_usd: pl.care_plan_usd, package: pl.package },
      status: 'awaiting_payment' }).select().single());
    let { data: inv } = await db.from('invoices').select('*').eq('project_id', proj.id).neq('status', 'void').maybeSingle();
    if (!inv) inv = must(await db.from('invoices').insert({ project_id: proj.id, customer_id: cust.id, amount_usd: pl.deposit_usd, status: 'draft' }).select().single());

    let payLine = '\n\nTo get started, reply to this email and I\'ll send a deposit invoice.';
    if (config.stripe.secretKey) {
      const { result } = await runOnce(`stripe:invoice:${inv.id}`, 'payment_link', () => createPaymentLink(inv, `${p.name} website deposit`));
      if (result?.url) {
        await db.from('invoices').update({ provider: 'stripe', provider_id: result.id, url: result.url, status: 'sent' }).eq('id', inv.id);
        payLine = `\n\nDeposit ($${pl.deposit_usd}) to get started: ${result.url}`;
      }
    }
    const body = pl.body.replace(/\n--\n[\s\S]*$/, '') + payLine + '\n' + legalFooter();
    await runOnce(`email:proposal:${proj.id}`, 'email', () => sendMail({ to: pl.to, subject: pl.subject, text: body }));
    await db.from('prospects').update({ deal_stage: 'proposal_sent', deal_value: pl.price_usd, next_step: 'Wait for deposit / questions', updated_at: new Date().toISOString() }).eq('id', p.id);
    await addLedger({ division: 'agency', category: 'revenue', amountUsd: pl.price_usd, basis: 'forecast', source: 'proposal sent', externalId: `forecast:project:${proj.id}`, note: 'Pipeline, not revenue' });
    const wf = await findWorkflow('prospect', p.id, 'agency_lead');
    await advance(wf?.id, 'postmaster', { stage: 'close', status: 'active', nextAction: 'Deposit payment or reply', note: `Proposal sent ($${pl.price_usd})` });
    await finish(a.id, 'executed', { project_id: proj.id, invoice_id: inv.id });
  },

  // Standing approvals: become authorities that let routine actions run within their exact limits.
  async email_campaign(a) { await standing(a, 'email_outreach'); },
  async calling_campaign(a) { await standing(a, 'calling'); },
  async marketing_campaign(a) { await standing(a, 'marketing'); },
  async fulfillment_policy(a) { await standing(a, null); },

  async product(a) {
    if (a.payload.product_id) {
      const r = await publishProduct(a.payload.product_id, a.payload);
      return finish(a.id, 'executed', r);
    }
    return finish(a.id, 'executed', { manual: true, note: 'Approved. No store connected; copy this listing manually.' });
  },

  async content(a) {
    const id = a.payload.content_id;
    const { data: item } = await db.from('content_items').select('*').eq('id', id).maybeSingle();
    if (!item) return finish(a.id, 'failed', { error: 'Content item not found' });
    if (['withdrawn', 'needs_revision'].includes(item.status)) return finish(a.id, 'rejected', { note: `Not released: ${item.withdraw_reason || item.status}` });
    await db.from('content_items').update({ status: 'approved', body: a.payload.body, updated_at: new Date().toISOString() }).eq('id', id);
    await finish(a.id, 'executed', { manual: true, note: 'Approved and queued. No posting integration is connected, so copy it from Sports Marketing and post it.' });
  },

  async social_post(a) { await finish(a.id, 'executed', { manual: true, note: 'Approved. Copy it from the dashboard and post it.' }); },
  async campaign(a) { await finish(a.id, 'executed', { note: 'Approved.' }); },

  async ds_launch(a) {
    const auth = await createAuthorityFromApproval(a);
    const r = await launchDropshipProduct(a);
    await finish(a.id, 'executed', { ...r, authority_id: auth.id, note: r.published ? 'Live. Matching orders inside the limits now fulfill automatically.' : 'Approved. Connect Shopify to publish.' });
  },
  async sample_purchase(a) {
    await db.from('ds_products').update({ sample_status: 'requested', updated_at: new Date().toISOString() }).eq('id', a.payload.product_id);
    await finish(a.id, 'executed', { manual: true, note: 'Place the sample order yourself, then mark it approved or rejected in Dropshipping when it arrives.' });
  },
  async re_letter(a) { await finish(a.id, 'executed', await executeRealEstate(a)); },
  async re_offer(a) { await finish(a.id, 'executed', await executeRealEstate(a)); },
  async re_deal_package(a) { await finish(a.id, 'executed', await executeRealEstate(a)); },
  async brand_experiment(a) { await finish(a.id, 'executed', await executeMedia(a)); },
  async brand_content(a) { await standing(a, null); await db.from('brands').update({ status: 'experimenting' }).eq('id', a.payload.brand_id); },
  async content_publish(a) { await finish(a.id, 'executed', await executeMedia(a)); },
  async ceo_promotion(a) { await finish(a.id, 'executed', await executeMedia(a)); },
  async budget_allocation(a) { await finish(a.id, 'executed', { note: 'Division budgets recorded. No money was moved.' }); },

  async opportunity_experiment(a) {
    const id = a.payload.opportunity_id;
    await db.from('opportunities').update({ status: 'approved_experiment', budget_usd: a.payload.budget_usd || 0, updated_at: new Date().toISOString() }).eq('id', id);
    if (a.payload.budget_usd) await addLedger({ division: 'ventures', category: 'commitment', amountUsd: a.payload.budget_usd, basis: 'forecast', source: 'approved experiment budget', externalId: `commit:opportunity:${id}` });
    await finish(a.id, 'executed', { note: 'Experiment approved. Spending stays inside its budget.' });
  },
};

async function standing(a, campaignKind) {
  const auth = await createAuthorityFromApproval(a);
  if (campaignKind) {
    const { data: existing } = await db.from('campaigns').select('id').eq('authority_id', auth.id).maybeSingle();
    if (!existing) await db.from('campaigns').insert({ division: a.division, kind: campaignKind, name: auth.title, status: 'active', rules: auth.rules, authority_id: auth.id });
  }
  await db.from('approvals').update({ authority_id: auth.id }).eq('id', a.id);
  await finish(a.id, 'executed', { authority_id: auth.id, note: `Active${auth.ends_at ? ` until ${new Date(auth.ends_at).toLocaleDateString('en-US')}` : ''}. Routine actions inside these limits now run automatically.` });
  await say(a.agent_id || 'manager', `Standing approval active: ${auth.title}`, 'success');
}

export async function runApprovals() {
  const { data, error } = await db.from('approvals').select('*').eq('status', 'approved').order('decided_at').limit(20);
  if (error) throw new Error(error.message);
  if ((data || []).length && data[0].payload_hash === undefined) {
    // The approval-safety columns don't exist yet: the database update (002_command_center.sql) hasn't been run.
    if (Date.now() - (runApprovals.warned || 0) < 30 * 60000) return;
    runApprovals.warned = Date.now();
    await say('manager', 'Approved items are waiting: run supabase/002_command_center.sql (and 003) in the Supabase SQL Editor, then they will send.', 'error');
    return;
  }
  // Per-business pause: approved items for a paused business wait (they are not cancelled).
  const { data: divs } = await db.from('divisions').select('id, status');
  const paused = new Set((divs || []).filter((d) => d.status === 'paused').map((d) => d.id));
  for (const a of data || []) {
    if (a.division && paused.has(a.division)) {
      if (!a.result?.waiting?.startsWith('Business paused')) await db.from('approvals').update({ result: { waiting: 'Business paused by owner. This runs when you resume it.' } }).eq('id', a.id);
      continue;
    }
    // Enforcement: exactly what was approved, still valid.
    if (!a.approved_hash || a.approved_hash !== a.payload_hash) { await finish(a.id, 'pending', { note: 'Content changed after approval; please review again.' }); continue; }
    if (a.expires_at && new Date(a.expires_at) < new Date()) { await finish(a.id, 'expired', { note: 'Approval window passed before it could run. Ask the agent to redo it.' }); continue; }
    const fn = executors[a.kind];
    if (!fn) { await finish(a.id, 'failed', { error: `No executor for ${a.kind}` }); continue; }
    try { await fn(a); }
    catch (e) {
      if (e.capped) { await db.from('approvals').update({ result: { waiting: e.message } }).eq('id', a.id); continue; }
      if (/not set up yet|not connected/i.test(e.message)) { await db.from('approvals').update({ result: { waiting: e.message } }).eq('id', a.id); continue; }
      await finish(a.id, 'failed', { error: e.message, duplicate_guard: e instanceof AlreadyAttempted });
      const wf = a.workflow_id ? { id: a.workflow_id } : null;
      await logEvent(wf?.id, a.agent_id, 'error', `Could not complete "${a.title}": ${e.message}`);
      await say(a.agent_id || 'manager', `Could not complete "${a.title}": ${e.message.slice(0, 160)}`, 'error');
    }
  }
}

export { addLedger };
