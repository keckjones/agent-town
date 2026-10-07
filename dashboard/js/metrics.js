// Every number shown in the command center comes from here, with its definition and basis.
// basis: actual (confirmed by a provider or by you) | estimated (calculated) | forecast (pipeline, not money) | na (not connected)

export const DEFINITIONS = {
  collected: 'Revenue collected: ledger rows in category "revenue" marked actual (Stripe payments, Etsy/Shopify paid orders excluding sales tax, real estate fees you confirmed). Pipeline and forecasts are never included.',
  refunds: 'Refunds: ledger rows in category "refund" marked actual.',
  contribution: 'Estimated contribution profit: collected revenue − refunds − ad spend − fulfillment − payment/platform fees − AI and software. Includes estimated fees and costs, so it is labeled an estimate.',
  ad_spend: 'Ad spend: ledger rows in category "ad_spend". No ad platform is connected, so this only includes spend you record.',
  fulfillment: 'Fulfillment costs: supplier and production charges (Printful actual; dropship supplier quotes until reconciled).',
  ai: 'AI & software: token usage × configured Claude prices (estimated), plus software rows in the ledger.',
  commitments: 'Cash commitments: approved experiment budgets and other commitments recorded in the ledger.',
  pipeline: 'Sales pipeline value: proposal amounts sent but not paid, plus estimated real estate assignment fees under contract. This is NOT revenue.',
  conversion: 'Conversion: share of contacted agency prospects that replied, and share of replies that became paid projects.',
};

const n = (v) => Number(v || 0);
const sum = (rows, f = 'amount_usd') => rows.reduce((s, r) => s + n(r[f]), 0);
export const money = (v, dp = 0) => (v < 0 ? '−$' : '$') + Math.abs(n(v)).toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
export const pct = (v) => (v == null || isNaN(v) ? '—' : `${(v * 100).toFixed(0)}%`);
export const daysAgo = (d) => new Date(Date.now() - d * 864e5).toISOString().slice(0, 10);

export function ledgerWindow(S, days, division = null) {
  const from = daysAgo(days);
  return S.t('ledger').filter((r) => r.occurred_on >= from && (!division || r.division === division));
}

export function finance(S, days = 30, division = null) {
  const L = ledgerWindow(S, days, division);
  const pick = (cat, basis) => sum(L.filter((r) => r.category === cat && (!basis || r.basis === basis)));
  const fromIso = new Date(Date.now() - days * 864e5).toISOString();
  const aiUsage = division && division !== 'hq' ? 0 : sum(S.t('usage').filter((u) => u.created_at >= fromIso), 'cost_usd');
  const collected = pick('revenue', 'actual');
  const refunds = pick('refund', 'actual');
  const ads = pick('ad_spend');
  const fulfillment = pick('fulfillment');
  const fees = pick('fees');
  const software = pick('software');
  const ai = aiUsage || pick('ai');
  const commitments = pick('commitment');
  const contribution = collected - refunds - ads - fulfillment - fees - software - ai;
  const lastUpdate = L[0]?.created_at || null;
  return { collected, refunds, ads, fulfillment, fees, software, ai, commitments, contribution, lastUpdate, rows: L.length };
}

export function pipeline(S) {
  const proposals = S.t('projects').filter((p) => ['proposal', 'awaiting_signature', 'awaiting_payment'].includes(p.status));
  const re = S.t('re_deals').filter((d) => ['under_contract', 'due_diligence', 'marketing', 'buyer_selected', 'assignment_signed', 'closing'].includes(d.stage));
  return { agency: sum(proposals, 'price_usd'), realestate: sum(re, 'fee_estimate_usd'), total: sum(proposals, 'price_usd') + sum(re, 'fee_estimate_usd') };
}

export function agencyFunnel(S) {
  const P = S.t('prospects');
  const by = (st) => P.filter((p) => p.deal_stage === st).length;
  const contacted = P.filter((p) => p.last_contacted_at).length;
  const replied = P.filter((p) => p.replied_at).length;
  const won = P.filter((p) => p.deal_stage === 'won').length + S.t('projects').filter((p) => ['onboarding', 'building', 'qa', 'delivered', 'support'].includes(p.status)).length;
  return { total: P.length, discovered: by('discovered'), qualified: by('qualified'), approve: by('approve_outreach'), contacted, replied, won,
    replyRate: contacted ? replied / contacted : null, closeRate: replied ? won / replied : null, optedOut: P.filter((p) => p.opted_out).length };
}

export function approvalsNeeded(S) { return S.t('approvals').filter((a) => a.status === 'pending'); }
export function failures(S) {
  const since = new Date(Date.now() - 864e5).toISOString();
  return { tasks: S.t('tasks').filter((t) => t.status === 'failed' && (t.finished_at || t.created_at) >= since), blocked: S.t('workflows').filter((w) => w.status === 'blocked'),
    integrations: S.t('integrations').filter((i) => i.status === 'error') };
}

export function orderStats(S, division) {
  const O = S.t('orders').filter((o) => o.division === division);
  const open = O.filter((o) => ['new', 'validated', 'fulfilling'].includes(o.status));
  const late = open.filter((o) => Date.now() - new Date(o.created_at) > 5 * 864e5);
  return { total: O.length, open: open.length, delayed: late.length, exceptions: O.filter((o) => o.status === 'exception').length,
    shipped: O.filter((o) => o.status === 'shipped').length, delivered: O.filter((o) => o.status === 'delivered').length, refunded: O.filter((o) => o.status === 'refunded').length,
    obligations: sum(open, 'cost_usd') };
}

export function reStats(S) {
  const D = S.t('re_deals');
  const st = (...s) => D.filter((d) => s.includes(d.stage)).length;
  const now = Date.now();
  return {
    leads: D.length, verified: D.filter((d) => d.seller_contact?.source).length,
    conversations: st('conversation', 'contacted'), meetings: st('meeting'),
    offersAwaiting: S.t('approvals').filter((a) => a.kind === 're_offer' && a.status === 'pending').length,
    executed: st('under_contract', 'due_diligence', 'marketing', 'buyer_selected', 'assignment_signed', 'closing'),
    deadlines: S.t('deadlines').filter((d) => d.status === 'open' && new Date(d.due_at) - now < 7 * 864e5).length,
    buyers: S.t('buyers').filter((b) => b.status === 'active').length,
    closing: st('closing', 'assignment_signed'),
    feesCollected: sum(D, 'fee_collected_usd'), feesEstimated: sum(D.filter((d) => d.stage !== 'closed' && d.stage !== 'cancelled'), 'fee_estimate_usd'),
  };
}

export function sportsStats(S) {
  const snap = S.t('sports_snapshots')[0];
  const C = S.t('content_items').filter((c) => c.division === 'sports');
  return { connected: !!snap, stale: snap?.stale, record: snap?.official_stats?.ALL?.record, units: snap?.official_stats?.ALL?.units, fetched: snap?.fetched_at,
    pending: C.filter((c) => c.status === 'pending_approval').length, approved: C.filter((c) => c.status === 'approved').length,
    withdrawn: C.filter((c) => c.status === 'withdrawn').length, open: S.t('sports_picks').filter((p) => ['UPCOMING', 'LIVE'].includes(p.status)).length };
}

export function agentsByDivision(S, division) { return S.t('agents').filter((a) => a.division === division); }
export function online(S) {
  if (S.demo) return true;
  const m = S.t('agents').find((a) => a.id === 'manager');
  return m?.last_seen && Date.now() - new Date(m.last_seen) < 4 * 60000;
}
export function aiToday(S) {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  return sum(S.t('usage').filter((u) => new Date(u.created_at) >= d), 'cost_usd');
}
