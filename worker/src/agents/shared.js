// Shared continuous-improvement agents: Experiment Design, Performance Learning, Capital Allocation,
// Risk & Quality, Workflow Improvement. None of them can change approval rules, permissions, limits, or success metrics.
import { db, must, say, requestApproval, addDocument, setIntegration } from '../lib/db.js';
import { askJSON } from '../lib/claude.js';
import { runOnce } from '../lib/actions.js';
import { shopify, shopifyReady } from '../lib/shopify.js';
import { sendSms } from '../lib/sms.js';
import { smsReady } from '../config.js';
import { logEvent, findWorkflow } from '../lib/workflows.js';

const sum = (rows, f = 'amount_usd') => (rows || []).reduce((s, r) => s + Number(r[f] || 0), 0);
const since = (days) => new Date(Date.now() - days * 864e5).toISOString();

/** Cash we actually have: collected minus paid, minus reserves and approved commitments. Never counts forecasts or pipeline. */
export async function cashPosition() {
  const { data: led } = await db.from('ledger').select('category, amount_usd, basis');
  const actual = (cat) => sum((led || []).filter((r) => r.category === cat && r.basis === 'actual'));
  const estimated = (cat) => sum((led || []).filter((r) => r.category === cat && r.basis === 'estimated'));
  const collected = actual('revenue') - actual('refund');
  const spent = actual('ad_spend') + actual('fulfillment') + actual('software') + actual('fees') + actual('ai')
    + estimated('ai') + estimated('fees') + estimated('fulfillment');    // estimates of money already gone count as spent
  const commitments = sum((led || []).filter((r) => r.category === 'commitment'));
  const { data: res } = await db.from('cash_reserves').select('*');
  const { data: recentRev } = await db.from('ledger').select('amount_usd').eq('category', 'revenue').eq('basis', 'actual').gte('created_at', since(30));
  const { data: openOrders } = await db.from('orders').select('cost_usd').in('status', ['new', 'validated', 'fulfilling']);
  const { data: ai30 } = await db.from('usage').select('cost_usd').gte('created_at', since(30));
  const reserves = {
    refunds: Math.max(Number(res?.find((r) => r.id === 'refunds')?.amount_usd || 0), +(sum(recentRev) * 0.1).toFixed(2)),
    suppliers: Math.max(Number(res?.find((r) => r.id === 'suppliers')?.amount_usd || 0), +sum(openOrders, 'cost_usd').toFixed(2)),
    deposits: Number(res?.find((r) => r.id === 'deposits')?.amount_usd || 0),
    operating: Math.max(Number(res?.find((r) => r.id === 'operating')?.amount_usd || 0), +sum(ai30, 'cost_usd').toFixed(2)),
  };
  const reserved = Object.values(reserves).reduce((a, b) => a + b, 0);
  return { collected: +collected.toFixed(2), spent: +spent.toFixed(2), commitments: +commitments.toFixed(2), reserves, reserved: +reserved.toFixed(2),
    available: +(collected - spent - commitments - reserved).toFixed(2), note: 'Only collected money counts. Pipeline and forecasts are excluded.' };
}

async function pauseDsProduct(p, reason) {
  if (p.stage === 'paused') return;
  if (shopifyReady() && p.store_product_id) {
    await runOnce(`shopify:pause:${p.id}:${new Date().toISOString().slice(0, 10)}`, 'shopify_pause', () =>
      shopify(`/products/${p.store_product_id}.json`, { method: 'PUT', json: { product: { id: Number(p.store_product_id), status: 'draft' } } }).then(() => ({ ok: true })));
  }
  await db.from('ds_products').update({ stage: 'paused', paused_reason: reason, updated_at: new Date().toISOString() }).eq('id', p.id);
  await db.from('authorities').update({ status: 'paused', updated_at: new Date().toISOString() }).eq('kind', 'dropship_fulfillment').contains('rules', { product_id: p.id });
  await say('risk', `Paused "${p.title}": ${reason}. To resume: fix the cause, then re-approve the launch.`, 'error');
}

export const handlers = {
  // ---------- Risk & Quality: thresholds → pause + explanation ----------
  async check_risks() {
    const { data: th } = await db.from('risk_thresholds').select('*');
    const T = Object.fromEntries((th || []).map((t) => [t.id, t]));
    const findings = [];

    // Dropshipping product health
    const { data: prods } = await db.from('ds_products').select('*').in('stage', ['listed']);
    for (const p of prods || []) {
      const { data: ords } = await db.from('orders').select('status, created_at, data').eq('division', 'dropship').gte('created_at', since(T.ds_refund_rate?.window_days || 30));
      const mine = (ords || []).filter((o) => (o.data?.line_items || []).some((l) => String(l.product_id) === p.store_product_id));
      if (mine.length >= 10) {
        const refundRate = mine.filter((o) => o.status === 'refunded').length / mine.length;
        const lateRate = mine.filter((o) => o.data?.exception).length / mine.length;
        if (refundRate > Number(T.ds_refund_rate?.limit_value ?? 0.08)) { await pauseDsProduct(p, `refund rate ${(refundRate * 100).toFixed(0)}% over ${mine.length} orders`); findings.push(p.title); continue; }
        if (lateRate > Number(T.ds_late_rate?.limit_value ?? 0.15)) { await pauseDsProduct(p, `late/lost rate ${(lateRate * 100).toFixed(0)}%`); findings.push(p.title); continue; }
      }
      const { data: q } = await db.from('supplier_quotes').select('*').eq('product_id', p.id).eq('supplier_id', p.supplier_id).order('observed_at', { ascending: false }).limit(1);
      const landed = Number(q?.[0]?.unit_cost_usd || 0) + Number(q?.[0]?.shipping_usd || 0);
      const price = Number(p.economics?.base?.revenue || 0);
      if (price && p.price_floor_usd && price < Number(p.price_floor_usd)) { await pauseDsProduct(p, `price $${price} is below the approved floor $${p.price_floor_usd} at current cost $${landed}`); findings.push(p.title); }
    }
    // Experiments over budget
    const { data: exps } = await db.from('experiments').select('*').eq('status', 'running');
    for (const e of exps || []) if (Number(e.budget_usd) > 0 && Number(e.spent_usd) >= Number(e.budget_usd)) {
      await db.from('experiments').update({ status: 'stopped', realized: { ...(e.realized || {}), stopped_reason: 'budget cap reached' } }).eq('id', e.id);
      await say('risk', `Experiment "${e.title}" stopped: spending reached its $${e.budget_usd} cap.`, 'warn'); findings.push(e.title);
    }
    // Deadlines in the next 72 hours (real estate, projects)
    const { data: dl } = await db.from('deadlines').select('*').eq('status', 'open').lte('due_at', new Date(Date.now() + 72 * 3600e3).toISOString());
    for (const d of dl || []) {
      const overdue = new Date(d.due_at) < new Date();
      await say('risk', `${overdue ? 'MISSED' : 'Due soon'}: ${d.kind.replace(/_/g, ' ')} for ${d.subject_type} #${d.subject_id} (${new Date(d.due_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })})`, overdue ? 'error' : 'warn');
      const { data: ns } = await db.from('notify_settings').select('*').eq('id', 1).maybeSingle();
      if (smsReady() && ns?.urgent_alerts && !ns.paused) {
        await runOnce(`sms:deadline:${d.id}:${overdue ? 'missed' : 'soon'}`, 'sms', () => sendSms(ns.phone, `KJ Agentic: ${overdue ? 'MISSED' : 'due within 72h'}: ${d.kind.replace(/_/g, ' ')} (deal #${d.subject_id}). Open the dashboard.`)).catch(() => {});
      }
      findings.push(`${d.kind} #${d.subject_id}`);
    }
    // Etsy exceptions
    const { count: ex } = await db.from('orders').select('*', { count: 'exact', head: true }).eq('platform', 'etsy').eq('status', 'exception');
    if ((ex || 0) >= Number(T.etsy_exception?.limit_value ?? 3)) findings.push(`${ex} Etsy order exceptions`);
    return { findings };
  },

  // ---------- Capital Allocation ----------
  async allocation_report() {
    const cash = await cashPosition();
    const { data: divs } = await db.from('ledger').select('division, category, amount_usd, basis').gte('occurred_on', since(30).slice(0, 10));
    const byDiv = {};
    for (const r of divs || []) {
      const d = (byDiv[r.division] ||= { collected: 0, costs: 0 });
      if (r.category === 'revenue' && r.basis === 'actual') d.collected += Number(r.amount_usd);
      else if (['ad_spend', 'fulfillment', 'fees', 'software', 'ai'].includes(r.category) && r.basis !== 'forecast') d.costs += Number(r.amount_usd);
    }
    const rec = await askJSON({
      agentId: 'capital', cheap: true, maxTokens: 1200,
      system: 'You recommend how to split AVAILABLE cash (never forecasts) across business divisions. Keep a buffer. If available cash is zero or negative, recommend spending nothing new.',
      prompt: `Cash position: ${JSON.stringify(cash)}\nLast 30 days by division (collected vs costs): ${JSON.stringify(byDiv)}
Return JSON {"allocations": [{"division": "...", "usd": n, "why": "..."}], "hold_back_usd": n, "summary": "..."}`,
    });
    let total = (rec.allocations || []).reduce((s, a) => s + Number(a.usd || 0), 0);
    const cap = Math.max(0, cash.available);
    if (total > cap) {
      const k = total ? cap / total : 0;
      rec.allocations = (rec.allocations || []).map((a) => ({ ...a, usd: +(Number(a.usd || 0) * k).toFixed(2) }));
      rec.summary = `[Scaled down to available cash] ${rec.summary}`;
      total = cap;
    }
    await addDocument('capital', 'research_report', `Capital allocation: ${new Date().toLocaleDateString('en-US')}`,
      `**Available (collected − spent − commitments − reserves):** $${cash.available}\n\n${rec.summary}\n\n${(rec.allocations || []).map((a) => `- ${a.division}: $${a.usd} — ${a.why}`).join('\n')}`, { cash, rec });
    if (total > 0 && cash.available > 0) {
      await requestApproval({ agentId: 'capital', kind: 'budget_allocation', division: 'finance', title: `Allocate $${Math.min(total, cash.available).toFixed(0)} of available cash`,
        reason: rec.summary, maxExposureUsd: Math.min(total, cash.available), reversible: true, expiresInHours: 72,
        scope: 'Sets division budgets. Does not move money.', payload: { allocations: rec.allocations, cash } });
    }
    return { available: cash.available };
  },

  // ---------- Performance Learning (weekly) ----------
  async weekly_learning() {
    const { data: led } = await db.from('ledger').select('*').gte('occurred_on', since(30).slice(0, 10));
    const { data: out } = await db.from('outreach_messages').select('kind, direction, status, created_at').gte('created_at', since(30));
    const { data: won } = await db.from('prospects').select('category, deal_stage, lead_score').in('deal_stage', ['won', 'lost', 'replied', 'proposal_sent']);
    const { data: exps } = await db.from('experiments').select('*');
    const { data: ords } = await db.from('orders').select('division, status, amount_usd, cost_usd, data').gte('created_at', since(30));
    const r = await askJSON({
      agentId: 'learning', maxTokens: 2500,
      system: `You analyze what produces COLLECTED revenue and contribution profit. Be honest about small samples (say "too early to tell" under ~20 events).
Account for refunds, delayed costs and incomplete real estate deals. Recommend changes with the evidence behind them. You cannot change rules or metrics.`,
      prompt: `Ledger (30d): ${JSON.stringify(led).slice(0, 6000)}\nOutreach (30d): ${JSON.stringify(out).slice(0, 3000)}\nAgency outcomes: ${JSON.stringify(won).slice(0, 3000)}
Experiments: ${JSON.stringify(exps).slice(0, 3000)}\nOrders (30d): ${JSON.stringify(ords).slice(0, 4000)}
Return JSON {"findings": [{"finding": "...", "evidence": "...", "confidence": "low|medium|high"}], "recommendations": ["..."], "failed_experiments": [{"title": "...", "cause": "..."}], "summary": "..."}`,
    });
    await addDocument('learning', 'research_report', `What's working: week of ${new Date().toLocaleDateString('en-US')}`,
      `${r.summary}\n\n${(r.findings || []).map((f) => `- **${f.finding}** (${f.confidence}): ${f.evidence}`).join('\n')}\n\n**Recommendations:**\n${(r.recommendations || []).map((x) => `- ${x}`).join('\n')}`, r);
    return { findings: r.findings?.length || 0 };
  },

  // ---------- Experiment Design ----------
  async design_experiment(task) {
    const r = await askJSON({
      agentId: 'experiments', cheap: true, maxTokens: 1200,
      system: 'You design small business experiments: a falsifiable hypothesis, a fixed budget, a time box, a minimum sample, success thresholds, and stop rules decided in advance.',
      prompt: `Division: ${task.input.division}. Idea: ${task.input.idea}. Max budget: $${task.input.max_budget || 50}.
Return JSON {"title": "...", "hypothesis": "...", "budget_usd": n, "days": n, "min_sample": n, "success": {"metric": "...", "threshold": "..."}, "stop_rules": ["..."], "expected": {"...": "..."}}`,
    });
    const { data: e } = await db.from('experiments').insert({ division: task.input.division, title: r.title, hypothesis: r.hypothesis, budget_usd: Math.min(Number(r.budget_usd || 0), Number(task.input.max_budget || 50)),
      starts_on: null, success: r.success, stop_rules: r.stop_rules, expected: r.expected, min_sample: r.min_sample, links: task.input.links || null }).select().single();
    return { experiment_id: e.id };
  },

  // ---------- Workflow Improvement (proposals only) ----------
  async find_bottlenecks() {
    const { data: wfs } = await db.from('workflows').select('division, kind, stage, status, updated_at').in('status', ['active', 'waiting_approval', 'blocked']);
    const now = Date.now();
    const stuck = (wfs || []).filter((w) => now - new Date(w.updated_at) > 3 * 864e5);
    const groups = stuck.reduce((m, w) => { const k = `${w.division}/${w.kind}/${w.stage}/${w.status}`; m[k] = (m[k] || 0) + 1; return m; }, {});
    const { data: aps } = await db.from('approvals').select('kind, created_at, decided_at, status').gte('created_at', since(30));
    const waits = (aps || []).filter((a) => a.decided_at).map((a) => (new Date(a.decided_at) - new Date(a.created_at)) / 36e5);
    const r = await askJSON({
      agentId: 'improve', cheap: true, maxTokens: 1500,
      system: 'You find bottlenecks and propose automation. You may NOT propose loosening approvals, permissions, spending limits, or changing success metrics.',
      prompt: `Stuck workflows (>3 days) by division/kind/stage/status: ${JSON.stringify(groups)}\nApproval wait hours (median): ${waits.length ? waits.sort((a, b) => a - b)[Math.floor(waits.length / 2)].toFixed(1) : 'n/a'} across ${waits.length}
Return JSON {"bottlenecks": [{"where": "...", "impact": "...", "proposal": "...", "test_plan": "how to try it safely, reversible"}]}`,
    });
    await addDocument('improve', 'research_report', `Workflow bottlenecks: ${new Date().toLocaleDateString('en-US')}`,
      (r.bottlenecks || []).map((b) => `- **${b.where}** (${b.impact}): ${b.proposal}. Test: ${b.test_plan}`).join('\n') || 'No bottlenecks found.', r);
    return { bottlenecks: r.bottlenecks?.length || 0 };
  },
};
