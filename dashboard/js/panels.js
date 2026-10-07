// What each station shows and lets you do. Every list is real data; estimates and pipeline are labeled.
import { esc, ago, ct, chip, md, kpi, section, statusChip, table, approvalCard, agentExplainer, workflowCard, integrationList } from './ui-core.js';
import * as M from './metrics.js';

const money = M.money;
const firstWf = (S, type, id, kind) => S.t('workflows').find((w) => w.subject_type === type && String(w.subject_id) === String(id) && (!kind || w.kind === kind));
const run = (agent, kind, label, input = {}, cls = 'btn') => `<button class="${cls}" data-act="run" data-agent="${agent}" data-kind="${kind}" data-input='${esc(JSON.stringify(input))}'>${esc(label)}</button>`;
const docList = (S, kinds, agents, limit = 8) => {
  const d = S.t('documents').filter((x) => (!kinds || kinds.includes(x.kind)) && (!agents || agents.includes(x.agent_id))).slice(0, limit);
  return d.length ? d.map((x) => `<details class="card"><summary class="row between" style="cursor:pointer"><b>${esc(x.title)}</b><span class="meta">${ago(x.created_at)}</span></summary>${md(x.body)}</details>`).join('') : '<p class="muted">No reports yet.</p>';
};

export const PANELS = {
  // ------------------------------------------------------------------ EXECUTIVE OVERVIEW
  overview(S) {
    const f7 = M.finance(S, 7), f30 = M.finance(S, 30);
    const pipe = M.pipeline(S), fails = M.failures(S), need = M.approvalsNeeded(S);
    const ds = M.orderStats(S, 'dropship'), et = M.orderStats(S, 'etsy');
    const divs = S.t('divisions');
    const goal = Number(S.t('settings')[0]?.weekly_goal || 2000);
    return [
      section('This week', `<div class="kpis">
        ${kpi('Collected (7d)', money(f7.collected), 'actual', M.DEFINITIONS.collected)}
        ${kpi(`Weekly goal ${money(goal)}`, M.pct(f7.collected / goal), 'actual')}
        ${kpi('Contribution (7d)', money(f7.contribution), 'estimated', M.DEFINITIONS.contribution)}
        ${kpi('Refunds (30d)', money(f30.refunds), 'actual', M.DEFINITIONS.refunds)}
        ${kpi('Ad spend (30d)', money(f30.ads), f30.ads ? 'actual' : 'na', M.DEFINITIONS.ad_spend)}
        ${kpi('Fulfillment (30d)', money(f30.fulfillment), 'estimated', M.DEFINITIONS.fulfillment)}
        ${kpi('AI & software (30d)', money(f30.ai + f30.software), 'estimated', M.DEFINITIONS.ai)}
        ${kpi('Cash commitments', money(f30.commitments), 'forecast', M.DEFINITIONS.commitments)}
        ${kpi('Sales pipeline', money(pipe.total), 'forecast', M.DEFINITIONS.pipeline)}
      </div>`, `ledger updated ${ago(f30.lastUpdate)}`),
      section('Needs you', `<div class="row"><button class="btn gold" data-act="goto" data-id="approvals">${need.length} approvals waiting</button>
        ${fails.blocked.length ? `<button class="btn danger" data-act="goto" data-id="approvals">${fails.blocked.length} blocked workflows</button>` : ''}
        ${fails.tasks.length ? `<span class="chip bad">${fails.tasks.length} failed jobs (24h)</span>` : ''}
        ${fails.integrations.length ? `<button class="btn danger" data-act="goto" data-id="setup">${fails.integrations.length} connection errors</button>` : ''}
        ${ds.exceptions + et.exceptions ? `<span class="chip bad">${ds.exceptions + et.exceptions} order exceptions</span>` : ''}</div>`),
      section('Performance by division (30 days)', table([
        { label: 'Division', get: (d) => d.name },
        { label: 'Collected', num: true, html: (d) => `<span class="up">${money(M.finance(S, 30, d.id).collected)}</span>` },
        { label: 'Costs', num: true, get: (d) => { const f = M.finance(S, 30, d.id); return money(f.ads + f.fulfillment + f.fees + f.software); } },
        { label: 'Contribution (est.)', num: true, html: (d) => { const v = M.finance(S, 30, d.id).contribution; return `<span class="${v < 0 ? 'down' : 'up'}">${money(v)}</span>`; } },
        { label: 'Open workflows', num: true, get: (d) => S.t('workflows').filter((w) => w.division === d.id && ['active', 'waiting_approval', 'blocked'].includes(w.status)).length },
      ], divs, { onRow: { act: 'goto-div', id: (d) => d.id } })),
      section('Agency funnel', (() => { const a = M.agencyFunnel(S); return `<div class="kpis">${kpi('Leads', a.total, 'actual')}${kpi('Contacted', a.contacted, 'actual')}${kpi('Reply rate', M.pct(a.replyRate), 'actual', M.DEFINITIONS.conversion)}${kpi('Won', a.won, 'actual')}</div>`; })()),
      section('Orchestrator', `<div class="row">${run('manager', 'plan', 'Review all divisions now', {}, 'btn primary')}</div>${docList(S, ['manager_plan'], null, 2)}`),
      section('What every agent is doing', agentExplainer(S, S.t('agents').filter((a) => a.division === 'hq').map((a) => a.id))),
    ].join('');
  },

  // ------------------------------------------------------------------ APPROVALS & ALERTS
  approvals(S, ui) {
    const tab = ui.tab || 'pending';
    const groups = {
      pending: S.t('approvals').filter((a) => ['pending', 'changes_requested', 'held'].includes(a.status)),
      running: S.t('approvals').filter((a) => ['approved', 'failed'].includes(a.status)),
      done: S.t('approvals').filter((a) => ['executed', 'rejected', 'expired', 'paused'].includes(a.status)).slice(0, 40),
    };
    const auths = S.t('authorities');
    const alerts = S.t('events').filter((e) => ['error', 'warn'].includes(e.level)).slice(0, 12);
    const blocked = S.t('workflows').filter((w) => w.status === 'blocked');
    const dl = S.t('deadlines').filter((d) => d.status === 'open' && new Date(d.due_at) - Date.now() < 7 * 864e5);
    return [
      `<div class="row">${['pending', 'running', 'done'].map((k) => `<button class="btn ${tab === k ? 'primary' : ''}" data-act="tab" data-id="${k}">${{ pending: 'Needs you', running: 'In progress', done: 'Done' }[k]} (${groups[k].length})</button>`).join('')}</div>`,
      groups[tab].length ? groups[tab].map((a) => approvalCard(a, S)).join('') : `<p class="muted">${tab === 'pending' ? 'Nothing needs you right now.' : 'Nothing here.'}</p>`,
      section('Standing approvals', auths.length ? auths.map((a) => `<div class="card"><div class="row between"><b>${esc(a.title)}</b>${statusChip(a.status)}</div>
        <div class="meta">${esc(a.kind)} · ${a.daily_limit ? `${a.daily_limit}/day · ` : ''}${Number(a.budget_usd) ? `${money(a.spent_usd)} of ${money(a.budget_usd)} · ` : ''}${a.ends_at ? `ends ${ct(a.ends_at)}` : 'no end date'}</div>
        <details class="x"><summary>Exact limits</summary><div class="pre">${esc(JSON.stringify(a.rules, null, 2))}</div></details>
        <div class="row">${a.status === 'active' ? `<button class="btn sm" data-act="auth-status" data-id="${a.id}" data-status="paused">Pause</button>` : a.status === 'paused' ? `<button class="btn sm" data-act="auth-status" data-id="${a.id}" data-status="active">Resume</button>` : ''}
        ${['active', 'paused'].includes(a.status) ? `<button class="btn sm danger" data-act="auth-status" data-id="${a.id}" data-status="revoked">Revoke</button>` : ''}</div></div>`).join('') : '<p class="muted">None yet. Create an outreach campaign in the Agency station.</p>'),
      section('Deadlines (7 days)', dl.length ? table([{ label: 'Due', get: (d) => ct(d.due_at) }, { label: 'What', get: (d) => d.kind.replace(/_/g, ' ') }, { label: 'For', get: (d) => `${d.subject_type} #${d.subject_id}` }, { label: '', html: (d) => new Date(d.due_at) < new Date() ? chip('missed', 'bad') : chip(ago(d.due_at), 'warn') }], dl) : '<p class="muted">No deadlines this week.</p>'),
      section('Blocked workflows', blocked.length ? blocked.map((w) => workflowCard(S, w)).join('') : '<p class="muted">Nothing blocked.</p>'),
      section('Recent alerts', alerts.length ? `<div class="timeline">${alerts.map((e) => `<div class="ev"><time>${ct(e.created_at)}</time><span class="${e.level === 'error' ? 'down' : 'gold'}">${esc(e.message)}</span></div>`).join('')}</div>` : '<p class="muted">No alerts.</p>'),
    ].join('');
  },

  // ------------------------------------------------------------------ AGENCY
  agency(S, ui) {
    if (ui.sub?.type === 'prospect') return prospectDetail(S, ui.sub.id);
    if (ui.sub?.type === 'call') return callDetail(S, ui.sub.id);
    const a = M.agencyFunnel(S);
    const st = S.t('settings')[0] || {};
    const P = S.t('prospects').filter((p) => ui.filter ? p.deal_stage === ui.filter : true).sort((x, y) => (y.lead_score || 0) - (x.lead_score || 0)).slice(0, 60);
    const calls = S.t('call_tasks').filter((c) => c.prospect_id && ['ready', 'scheduled'].includes(c.status));
    const projects = S.t('projects');
    const stages = ['discovered', 'qualified', 'approve_outreach', 'contacted', 'replied', 'meeting', 'proposal_sent', 'won', 'lost', 'disqualified'];
    return [
      `<div class="kpis">${kpi('Leads', a.total, 'actual')}${kpi('Contacted', a.contacted, 'actual')}${kpi('Replied', a.replied, 'actual')}${kpi('Reply rate', M.pct(a.replyRate), 'actual', M.DEFINITIONS.conversion)}${kpi('Won', a.won, 'actual')}${kpi('Pipeline', money(M.pipeline(S).agency), 'forecast', M.DEFINITIONS.pipeline)}</div>`,
      `<div class="row">${run('scout', 'find_prospects', 'Find leads now', { limit: 10 }, 'btn primary')}${run('postmaster', 'run_followups', 'Run follow-ups')}${run('support', 'process_inbox', 'Check replies')}
        <button class="btn gold" data-act="modal" data-id="campaign">New outreach campaign</button></div>`,
      section('Pipeline', `<div class="row">${['', ...stages].map((s) => `<button class="btn sm ${ui.filter === s || (!ui.filter && !s) ? 'primary' : ''}" data-act="filter" data-id="${s}">${s ? `${s.replace(/_/g, ' ')} (${S.t('prospects').filter((p) => p.deal_stage === s).length})` : 'All'}</button>`).join('')}</div>`),
      table([
        { label: 'Business', html: (p) => `<b>${esc(p.name)}</b><div class="meta">${esc(p.category || '')} · ${esc((p.address || '').split(',').slice(-3, -1).join(',').trim())}</div>` },
        { label: 'Score', num: true, html: (p) => p.lead_score != null ? `<span class="${p.lead_score >= 70 ? 'up' : ''}">${p.lead_score}</span>` : '—' },
        { label: 'Site', num: true, get: (p) => p.website ? (p.site_score ?? '—') : 'none' },
        { label: 'Stage', html: (p) => statusChip(p.deal_stage) },
        { label: 'Next', html: (p) => `<span class="meta">${esc(p.next_step || '—')}${p.next_step_at ? ` · ${ago(p.next_step_at)}` : ''}</span>` },
      ], P, { onRow: { act: 'open-prospect', id: (p) => p.id }, empty: 'No leads yet. Press "Find leads now".' }),
      section('Calls to make', calls.length ? table([{ label: 'Business', get: (c) => S.t('prospects').find((p) => p.id === c.prospect_id)?.name || `#${c.prospect_id}` }, { label: 'Phone', get: (c) => c.phone }, { label: 'Goal', get: (c) => c.objective }, { label: 'Mode', html: (c) => chip(c.mode === 'ai' ? 'AI' : 'you call', c.mode === 'ai' ? 'ops' : 'warn') }],
        calls, { onRow: { act: 'open-call', id: (c) => c.id } }) : '<p class="muted">No calls queued.</p>', 'AI-voice calling is off without written consent'),
      section('Projects & invoices', projects.length ? table([{ label: 'Project', get: (p) => p.title }, { label: 'Price', num: true, get: (p) => money(p.price_usd) }, { label: 'Status', html: (p) => statusChip(p.status) },
        { label: 'Invoice', html: (p) => { const i = S.t('invoices').find((x) => x.project_id === p.id); return i ? `${statusChip(i.status)} ${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">link</a>` : ''}` : '—'; } }], projects) : '<p class="muted">No projects yet.</p>'),
      section('Campaign settings', `<form class="card" data-form="agency-settings"><div class="grid2">
        <label class="f">Areas (comma separated)<input class="i" id="f-areas" value="${esc((st.outreach_areas || []).join(', '))}"></label>
        <label class="f">Business types<input class="i" id="f-cats" value="${esc((st.outreach_categories || []).join(', '))}"></label>
        <label class="f">Emails per day<input class="i" id="f-cap" type="number" value="${esc(st.daily_email_cap)}"></label>
        <label class="f">New leads per day<input class="i" id="f-leads" type="number" value="${esc(st.daily_prospect_cap)}"></label></div>
        <label class="f">Your offer (used in emails)<textarea class="i" id="f-offer" style="min-height:70px">${esc(st.outreach_offer)}</textarea></label>
        <label class="f">Approved pricing (JSON)<textarea class="i" id="f-pricing" style="min-height:90px;font-family:var(--mono)">${esc(JSON.stringify(st.agency_pricing || {}, null, 2))}</textarea></label>
        <button class="btn primary">Save agency settings</button></form>`),
      section('Agents', agentExplainer(S, ['scout', 'inspector', 'designer', 'qa', 'postmaster', 'caller'])),
    ].join('');
  },

  // ------------------------------------------------------------------ SPORTS
  sports(S) {
    const s = M.sportsStats(S);
    const items = S.t('content_items').filter((c) => c.division === 'sports').slice(0, 30);
    const picks = S.t('sports_picks').slice(0, 25);
    return [
      `<div class="kpis">${kpi('Official record', s.record || '—', s.connected ? 'actual' : 'na')}${kpi('Units', s.units ?? '—', s.connected ? 'actual' : 'na')}${kpi('Open official picks', s.open, s.connected ? 'actual' : 'na')}${kpi('Posts awaiting you', s.pending, 'actual')}${kpi('Withdrawn (pick changed)', s.withdrawn, 'actual')}</div>`,
      s.connected ? (s.stale ? '<div class="note err">Model data is STALE or failed its integrity check. No pick content is drafted until a fresh run.</div>' : `<div class="note">Last import ${ago(s.fetched)}. Only official-ledger picks are used; odds always carry a timestamp.</div>`) : '<div class="note warn">Not connected to KJ\'s Picks yet. See Connections for the steps.</div>',
      `<div class="row">${run('sports', 'sync_picks', 'Import picks now', {}, 'btn primary')}${run('sports', 'draft_content', 'Draft posts')}</div>`,
      section('Content queue', items.length ? table([{ label: 'Channel', get: (c) => c.channel?.replace('sports_', '') }, { label: 'Post', html: (c) => `<div style="max-width:320px">${esc(c.body.slice(0, 160))}…</div>` }, { label: 'Status', html: (c) => `${statusChip(c.status)}${c.withdraw_reason ? `<div class="meta">${esc(c.withdraw_reason)}</div>` : ''}` },
        { label: '', html: (c) => c.status === 'approved' ? `<button class="btn sm" data-act="copy" data-text="${esc(c.body)}">Copy</button> <button class="btn sm" data-act="mark-posted" data-id="${c.id}">Mark posted</button>` : '' }], items) : '<p class="muted">No posts yet.</p>'),
      section('Channels', S.t('channels').filter((c) => c.division === 'sports').map((c) => `<div class="card"><div class="row between"><b>${esc(c.name)}</b>${c.enabled ? chip('enabled', 'ok') : chip('off')}</div>
        <div class="meta">${esc(Object.entries(c.requirements || {}).map(([k, v]) => `${k}: ${v}`).join(' · '))}</div>
        ${c.policy_verified_at ? `<div class="meta">Policy verified ${ct(c.policy_verified_at)}: ${esc(c.policy_notes || '')}</div>` : ''}
        ${c.requirements?.blocked_until ? `<div class="note warn">Blocked until: ${esc(c.requirements.blocked_until)}</div>` : `<form class="row" data-form="channel" data-id="${c.id}"><input class="i" id="pol-${c.id}" placeholder="What you checked in the platform's current gambling-content rules (required)" value="${esc(c.policy_notes || '')}" style="flex:1 1 240px">
          <button class="btn sm ${c.enabled ? 'danger' : 'go'}">${c.enabled ? 'Disable' : 'Verify & enable'}</button></form>`}</div>`).join('')),
      section('Official picks (read-only)', table([{ label: 'Kickoff', get: (p) => ct(p.kickoff) }, { label: 'Pick', get: (p) => `${p.league} ${p.pick}` }, { label: 'Odds', get: (p) => p.odds || '—' }, { label: 'As of', get: (p) => ct(p.odds_as_of) }, { label: 'Status', html: (p) => statusChip(p.status) }], picks, { empty: 'No picks imported.' })),
      section('Attribution', '<div class="note">Posts carry UTM-tagged links. Visits and signups appear here once the sports site records UTM parameters on sign-up (it currently stores page and referrer only). Ask me to add that to the sports project.</div>'),
      section('Agents', agentExplainer(S, ['sports', 'marketer', 'social'])),
    ].join('');
  },

  // ------------------------------------------------------------------ ETSY
  etsy(S, ui) {
    const P = S.t('products');
    const o = M.orderStats(S, 'etsy'), f = M.finance(S, 30, 'etsy');
    const etsyInt = S.t('integrations').find((i) => i.id === 'etsy');
    const pub = S.t('integrations').find((i) => i.id === 'public_url');
    return [
      `<div class="kpis">${kpi('Collected (30d)', money(f.collected), 'actual')}${kpi('Fees (30d)', money(f.fees), 'estimated')}${kpi('Contribution', money(f.contribution), 'estimated')}${kpi('Open orders', o.open, 'actual')}${kpi('Exceptions', o.exceptions, 'actual')}${kpi('Listed', P.filter((p) => p.stage === 'listed').length, 'actual')}</div>`,
      `<div class="row">${run('etsy', 'research_products', 'Research products', {}, 'btn primary')}${run('fulfillment', 'sync_orders', 'Sync orders')}
        ${etsyInt?.status === 'connected' ? chip('Etsy connected', 'ok') : pub?.detail?.startsWith('http') ? `<a class="btn gold" href="${esc(pub.detail)}/oauth/etsy/start" target="_blank" rel="noopener">Connect Etsy</a>` : '<span class="chip warn">Etsy needs setup (see Connections)</span>'}</div>`,
      section('Products', table([{ label: 'Product', html: (p) => `<b>${esc(p.title)}</b><div class="meta">${esc(p.fulfillment_model || '')}${p.ip_check?.flagged ? ' · IP RISK' : ''}</div>` },
        { label: 'Stage', html: (p) => statusChip(p.stage) },
        { label: 'Base contribution', num: true, html: (p) => p.economics?.base ? `<span class="basis-estimated">${money(p.economics.base.contribution, 2)}</span>` : '—' },
        { label: 'Evidence', get: (p) => p.concept?.evidence_quality || '—' },
        { label: 'Sample', html: (p) => p.sample_status === 'needed' ? `<button class="btn sm" data-act="etsy-sample" data-id="${p.id}" data-status="approved">Sample OK</button>` : esc(p.sample_status || '') }], P.slice(0, 40), { empty: 'No products yet.' })),
      section('Orders', table([{ label: 'Order', get: (x) => x.external_id }, { label: 'Amount', num: true, get: (x) => money(x.amount_usd, 2) }, { label: 'Status', html: (x) => statusChip(x.status) }, { label: 'When', get: (x) => ago(x.created_at) }],
        S.t('orders').filter((x) => x.division === 'etsy').slice(0, 30), { empty: 'No orders yet.' })),
      '<div class="note">Etsy buyer messages aren\'t available through Etsy\'s API, so answer those in the Etsy app. Digital files are delivered by Etsy automatically; print-on-demand ships through Printful\'s own Etsy connection.</div>',
      section('Agents', agentExplainer(S, ['etsy', 'merchant', 'fulfillment'])),
    ].join('');
  },

  // ------------------------------------------------------------------ DROPSHIPPING
  dropship(S, ui) {
    const P = S.t('ds_products');
    const o = M.orderStats(S, 'dropship'), f = M.finance(S, 30, 'dropship');
    const sups = S.t('suppliers');
    const ex = S.t('orders').filter((x) => x.division === 'dropship' && x.status === 'exception');
    const shop = S.t('integrations').find((i) => i.id === 'shopify');
    return [
      `<div class="kpis">${kpi('Collected (30d)', money(f.collected), 'actual', 'Excludes sales tax collected for the state')}${kpi('Contribution', money(f.contribution), 'estimated', M.DEFINITIONS.contribution)}${kpi('Ad cost', money(f.ads), f.ads ? 'actual' : 'na')}
        ${kpi('Open orders', o.open, 'actual')}${kpi('Delivery exceptions', o.exceptions, 'actual')}${kpi('Refunds', money(f.refunds), 'actual')}${kpi('Supplier obligations', money(o.obligations), 'estimated', 'Supplier cost of orders accepted but not yet reconciled')}</div>`,
      shop?.status === 'connected' ? '' : '<div class="note warn">Shopify isn\'t connected, so this division stays in research mode: nothing is listed and no orders arrive. See Connections.</div>',
      `<div class="row">${run('ds_research', 'research_niches', 'Research a niche', {}, 'btn primary')}${run('ds_orders', 'sync_shopify_orders', 'Check tracking')}</div>`,
      section('Exception queue', ex.length ? ex.map((x) => `<div class="card err"><div class="row between"><b>${esc(x.external_id)}</b>${money(x.amount_usd, 2)}</div><div class="meta">${esc((x.data?.holds || [x.data?.exception]).filter(Boolean).join('; '))}</div>
        <div class="row"><button class="btn sm" data-act="ds-release" data-id="${x.id}">Re-check after fixing</button></div></div>`).join('') : '<p class="muted">No held or late orders.</p>'),
      section('Products', table([{ label: 'Product', html: (p) => `<b>${esc(p.title)}</b><div class="meta">${esc(p.niche || '')}</div>` },
        { label: 'Score', num: true, get: (p) => p.scores?.total ?? '—' },
        { label: 'Flags', html: (p) => Object.entries(p.flags || {}).filter(([, v]) => v).map(([k]) => chip(k.replace(/_/g, ' '), 'bad')).join(' ') || '—' },
        { label: 'Call', html: (p) => p.recommendation === 'do_not_launch' ? chip('do not launch', 'bad') : p.recommendation === 'test' ? chip('test', 'ops') : '—' },
        { label: 'Base / order', num: true, html: (p) => p.economics?.base ? `<span class="basis-estimated">${money(p.economics.base.contribution, 2)}</span><div class="meta">break-even ad ${money(p.economics.base.break_even_cac, 2)}</div>` : '—' },
        { label: 'Stage', html: (p) => statusChip(p.stage) + (p.paused_reason ? `<div class="meta down">${esc(p.paused_reason)}</div>` : '') },
        { label: 'Sample', html: (p) => ['needed', 'requested', 'received'].includes(p.sample_status) && p.stage !== 'rejected' ? `<button class="btn sm go" data-act="ds-sample" data-id="${p.id}" data-status="approved">Approve</button> <button class="btn sm danger" data-act="ds-sample" data-id="${p.id}" data-status="rejected">Reject</button>` : esc(p.sample_status) }], P.slice(0, 40), { empty: 'No products researched yet.' })),
      section('Suppliers', table([{ label: 'Supplier', html: (s) => `<b>${esc(s.name)}</b><div class="meta">${esc((s.warehouses || []).join(', '))}</div>` }, { label: 'Ship days', get: (s) => s.shipping_days ? `${s.processing_days ?? '?'} + ${s.shipping_days.min}-${s.shipping_days.max}` : '—' },
        { label: 'Tracking', get: (s) => (s.tracking ? 'yes' : 'no') }, { label: 'Status', html: (s) => statusChip(s.status) }, { label: 'On-time', get: (s) => s.performance?.on_time_rate != null ? M.pct(s.performance.on_time_rate) : 'no orders yet' }], sups, { empty: 'No suppliers yet.' })),
      section('Approval boundaries', `<form class="card" data-form="ds-rules">${(() => { const r = S.t('settings')[0]?.dropship_rules || {}; return `<div class="grid2">
        <label class="f">Minimum margin<input class="i" id="ds-margin" type="number" step="0.01" value="${esc(r.min_margin_pct)}"></label>
        <label class="f">Max supplier cost per order ($)<input class="i" id="ds-cost" type="number" value="${esc(r.max_order_cost_usd)}"></label>
        <label class="f">Max test ad budget ($)<input class="i" id="ds-ads" type="number" value="${esc(r.max_test_ad_budget_usd)}"></label>
        <label class="f">Hold orders above ($)<input class="i" id="ds-hold" type="number" value="${esc(r.hold_high_value_usd)}"></label></div>`; })()}
        <div class="note">Changing these doesn't widen launches you already approved: each launch keeps the limits it was approved with.</div><button class="btn">Save boundaries</button></form>`),
      section('Agents', agentExplainer(S, ['ds_research', 'ds_product', 'ds_supplier', 'ds_store', 'ds_orders'])),
    ].join('');
  },

  // ------------------------------------------------------------------ REAL ESTATE
  realestate(S, ui) {
    if (ui.sub?.type === 'deal') return dealDetail(S, ui.sub.id);
    const r = M.reStats(S);
    const j = S.t('re_jurisdictions').find((x) => x.id === 'TX');
    const D = S.t('re_deals').slice(0, 50);
    const props = Object.fromEntries(S.t('properties').map((p) => [p.id, p]));
    return [
      `<div class="kpis">${kpi('Verified leads', r.verified, 'actual')}${kpi('Seller conversations', r.conversations, 'actual')}${kpi('Meetings', r.meetings, 'actual')}${kpi('Offers awaiting you', r.offersAwaiting, 'actual')}
        ${kpi('Executed contracts', r.executed, 'actual')}${kpi('Deadlines (7d)', r.deadlines, 'actual')}${kpi('Opt-in buyers', r.buyers, 'actual')}${kpi('At closing', r.closing, 'actual')}
        ${kpi('Fees collected', money(r.feesCollected), 'actual')}${kpi('Fees estimated', money(r.feesEstimated), 'forecast', 'Assignment fees on deals not yet closed: not revenue')}</div>`,
      section('Texas legal status', j ? `<div class="card ${j.status === 'research_only' ? 'prio' : ''}"><div class="row between"><b>${esc(j.name)}</b>${chip(j.status.replace(/_/g, ' '), j.status === 'transactions_ok' ? 'ok' : 'warn')}</div>
        <ul>${Object.entries(j.requirements || {}).filter(([, v]) => v && v.rule).map(([k, v]) => `<li><b>${esc(k.replace(/_/g, ' '))}:</b> ${esc(v.rule)} <span class="faint">${esc(v.source || '')}</span></li>`).join('')}</ul>
        <div class="note warn">${esc(j.requirements?.needs_attorney || '')}</div>
        ${j.attorney_review ? `<div class="meta">Reviewed: ${esc(JSON.stringify(j.attorney_review))}</div>` : ''}
        <details class="x"><summary>Record attorney review / change status</summary><form class="card" data-form="re-legal">
          <div class="grid2"><label class="f">Attorney / firm<input class="i" id="re-att" value="${esc(j.attorney_review?.reviewer || '')}"></label><label class="f">Reviewed on<input class="i" id="re-date" type="date" value="${esc(j.attorney_review?.reviewed_on || '')}"></label></div>
          <label class="f">Approved templates (one per line: name | version)<textarea class="i" id="re-templates" style="min-height:80px">${esc((j.approved_templates || []).map((t) => `${t.name} | ${t.version}`).join('\n'))}</textarea></label>
          <label class="f">Status<select class="i" id="re-status">${['research_only', 'outreach_ok', 'transactions_ok'].map((s) => `<option ${s === j.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label class="f">Type CONFIRMED to save a status change<input class="i" id="re-confirm" placeholder="CONFIRMED"></label>
          <button class="btn gold">Save legal status</button></form></details></div>` : '<div class="note err">Run 003_dropship_realestate.sql.</div>'),
      `<div class="row">${run('re_market', 'market_report', 'Market report', {}, 'btn primary')}<button class="btn" data-act="modal" data-id="import-leads">Import leads (CSV)</button><button class="btn" data-act="modal" data-id="add-buyer">Add opt-in buyer</button></div>`,
      section('Deals', table([{ label: 'Property', html: (d) => `<b>${esc(props[d.property_id]?.address || `#${d.property_id}`)}</b><div class="meta">${esc(props[d.property_id]?.owner?.name || '')}</div>` },
        { label: 'Stage', html: (d) => statusChip(d.stage) }, { label: 'Max offer', num: true, get: (d) => d.max_offer_usd ? money(d.max_offer_usd) : '—' },
        { label: 'Fee', num: true, html: (d) => d.fee_collected_usd ? `<span class="up">${money(d.fee_collected_usd)}</span>` : d.fee_estimate_usd ? `<span class="basis-forecast">${money(d.fee_estimate_usd)} est.</span>` : '—' },
        { label: 'Blocker', html: (d) => d.blockers ? `<span class="meta down">${esc(d.blockers)}</span>` : '' }], D, { onRow: { act: 'open-deal', id: (d) => d.id }, empty: 'No leads yet. Import a list from county records.' })),
      section('Buyers (opt-in only)', table([{ label: 'Buyer', get: (b) => b.name }, { label: 'Criteria', html: (b) => `<span class="meta">${esc(JSON.stringify(b.criteria || {}))}</span>` }, { label: 'Consent', html: (b) => `<span class="meta">${esc(b.consent?.how || '')} ${esc(b.consent?.when || '')}</span>` }, { label: 'Status', html: (b) => statusChip(b.status) }], S.t('buyers'), { empty: 'No buyers yet.' })),
      section('Reports', docList(S, ['research_report'], ['re_market', 're_deals'], 4)),
      section('Agents', agentExplainer(S, ['re_market', 're_leads', 're_underwrite', 're_deals', 're_buyers'])),
    ].join('');
  },

  // ------------------------------------------------------------------ VENTURES
  ventures(S) {
    const O = S.t('opportunities');
    const E = S.t('experiments');
    return [
      `<div class="row">${run('opportunity', 'propose_opportunities', 'Propose opportunities', {}, 'btn primary')}${run('research', 'research', 'Research a question…', { topic: '' }).replace('data-act="run"', 'data-act="ask-research"')}${run('learning', 'weekly_learning', 'What\'s working?')}${run('improve', 'find_bottlenecks', 'Find bottlenecks')}</div>`,
      section('Opportunity memos', O.length ? O.map((o) => `<details class="card ${o.status === 'proposed' ? 'prio' : ''}"><summary class="row between" style="cursor:pointer"><b>${esc(o.title)}</b><span>${chip(`score ${o.scores?.total ?? '?'}`, 'ops')} ${statusChip(o.status)}</span></summary>
        ${md(o.memo)}<div class="meta">Scores: ${esc(Object.entries(o.scores || {}).filter(([k]) => k !== 'total').map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}/5`).join(' · '))}</div></details>`).join('') : '<p class="muted">No memos yet.</p>'),
      section('Experiments', table([{ label: 'Experiment', html: (e) => `<b>${esc(e.title)}</b><div class="meta">${esc(e.hypothesis)}</div>` }, { label: 'Budget', num: true, get: (e) => `${money(e.spent_usd)} / ${money(e.budget_usd)}` },
        { label: 'Min sample', num: true, get: (e) => e.min_sample ?? '—' }, { label: 'Status', html: (e) => statusChip(e.status) }], E, { empty: 'No experiments designed yet.' })),
      section('Research, learning & improvement reports', docList(S, ['research_report'], ['research', 'learning', 'improve', 'capital'], 10)),
      section('Agents', agentExplainer(S, ['research', 'opportunity', 'experiments', 'learning', 'improve', 'capital', 'risk'])),
    ].join('');
  },

  // ------------------------------------------------------------------ CUSTOMERS
  customers(S, ui) {
    if (ui.sub?.type === 'conv') return convDetail(S, ui.sub.id);
    const C = S.t('conversations');
    const open = C.filter((c) => c.status !== 'resolved');
    const name = (c) => S.t('prospects').find((p) => p.id === c.prospect_id)?.name || S.t('customers').find((x) => x.id === c.customer_id)?.name || `#${c.id}`;
    return [
      `<div class="kpis">${kpi('Open conversations', open.length, 'actual')}${kpi('Waiting on us', C.filter((c) => c.status === 'waiting_on_us').length, 'actual')}${kpi('Escalated', C.filter((c) => c.status === 'escalated').length, 'actual')}${kpi('Do-not-contact', S.t('suppression').length, 'actual')}</div>`,
      `<div class="row">${run('support', 'process_inbox', 'Check inbox now', {}, 'btn primary')}</div>`,
      section('Inbox', table([{ label: 'Who', get: name }, { label: 'Summary', html: (c) => `<span class="meta">${esc(c.summary || c.subject || '')}</span>` }, { label: 'Status', html: (c) => statusChip(c.status) }, { label: 'Last', get: (c) => ago(c.last_message_at) }], C.slice(0, 50), { onRow: { act: 'open-conv', id: (c) => c.id }, empty: 'No conversations yet.' })),
      section('Do-not-contact list', `<form class="row" data-form="suppress"><input class="i" id="sup-email" type="email" placeholder="email@example.com" required style="flex:1 1 220px"><button class="btn danger">Never contact</button></form>
        <div class="meta">${S.t('suppression').slice(0, 30).map((s) => esc(s.email)).join(' · ') || 'Empty'}</div>`),
      '<div class="note">Etsy buyer messages are answered in the Etsy app (no API). Shopify customer emails arrive at the store\'s support address; connect that mailbox the same way as Gmail to bring them here.</div>',
      section('Agents', agentExplainer(S, ['support'])),
    ].join('');
  },

  // ------------------------------------------------------------------ FINANCE
  finance(S) {
    const f = M.finance(S, 30);
    const L = S.t('ledger').slice(0, 60);
    const ns = S.t('notify_settings')[0] || {};
    const sms = S.t('sms_messages');
    const lastDigest = sms.find((m) => m.kind === 'digest'), lastTest = sms.find((m) => m.kind === 'test');
    const tw = S.t('integrations').find((i) => i.id === 'twilio');
    const st = S.t('settings')[0] || {};
    const [hh, mm] = (ns.digest_time || '07:30').split(':').map(Number);
    const nowCt = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    const next = new Date(nowCt); next.setHours(hh, mm, 0, 0); if (next <= nowCt) next.setDate(next.getDate() + 1);
    const reserves = S.t('cash_reserves');
    return [
      section('Last 30 days', `<div class="kpis">${kpi('Collected', money(f.collected), 'actual', M.DEFINITIONS.collected)}${kpi('Refunds', money(f.refunds), 'actual')}${kpi('Contribution', money(f.contribution), 'estimated', M.DEFINITIONS.contribution)}
        ${kpi('Ads', money(f.ads), f.ads ? 'actual' : 'na')}${kpi('Fulfillment', money(f.fulfillment), 'estimated')}${kpi('Fees', money(f.fees), 'estimated')}${kpi('AI today', money(M.aiToday(S), 2), 'estimated', M.DEFINITIONS.ai)}${kpi('Pipeline', money(M.pipeline(S).total), 'forecast', M.DEFINITIONS.pipeline)}</div>`),
      section('Morning text: 7:30 AM to (940) 366-1992', `<div class="card ${tw?.status === 'connected' ? '' : 'prio'}">
        <dl class="facts"><dt>Status</dt><dd>${tw?.status === 'connected' ? '<span class="up">Verified: a test text was delivered</span>' : `<span class="gold">Not active yet</span>: ${esc(tw?.detail || 'Twilio not connected')}`}</dd>
        <dt>Schedule</dt><dd>Every day at ${esc(ns.digest_time || '07:30')} ${esc(ns.timezone || 'America/Chicago')}${ns.paused || ns.digest_enabled === false ? ' <span class="down">(paused)</span>' : ''}</dd>
        <dt>Next send</dt><dd>${next.toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT</dd>
        <dt>Last digest</dt><dd>${lastDigest ? `${esc(lastDigest.digest_date)}: ${statusChip(lastDigest.status)} ${esc(lastDigest.error || '')}` : 'none yet'}</dd>
        <dt>Last test</dt><dd>${lastTest ? `${ago(lastTest.created_at)}: ${statusChip(lastTest.status)} ${esc(lastTest.error || '')}` : 'none yet'}</dd></dl>
        <div class="row"><button class="btn primary" data-act="test-text">Send test text</button></div>
        <form class="row" data-form="notify"><label class="f">Time (CT)<input class="i" id="n-time" type="time" value="${esc(ns.digest_time || '07:30')}"></label>
          <label class="f">Daily digest<select class="i" id="n-on"><option value="1" ${ns.digest_enabled !== false ? 'selected' : ''}>On</option><option value="0" ${ns.digest_enabled === false ? 'selected' : ''}>Off</option></select></label>
          <label class="f">Urgent alerts<select class="i" id="n-urgent"><option value="0" ${!ns.urgent_alerts ? 'selected' : ''}>Off</option><option value="1" ${ns.urgent_alerts ? 'selected' : ''}>On</option></select></label>
          <label class="f">Dashboard link in text<input class="i" id="n-url" value="${esc(ns.dashboard_url || location.origin)}"></label>
          <button class="btn">Save</button></form>
        ${lastDigest ? `<details class="x"><summary>Last digest text</summary><div class="pre">${esc(lastDigest.body)}</div></details>` : ''}</div>`),
      section('Reserves & budgets', `<form class="card" data-form="reserves"><div class="grid2">${reserves.map((r) => `<label class="f">${esc(r.description)}<input class="i" data-res="${esc(r.id)}" type="number" value="${esc(r.amount_usd)}"></label>`).join('')}</div>
        <div class="grid2"><label class="f">Max AI spend per day ($)<input class="i" id="b-ai" type="number" step="0.5" value="${esc(st.daily_budget_usd)}"></label><label class="f">Weekly goal ($)<input class="i" id="b-goal" type="number" value="${esc(st.weekly_goal)}"></label></div>
        <div class="note">Capital Allocation never counts pipeline or forecasts, and keeps these reserves before recommending spending.</div><button class="btn">Save</button></form>
        <div class="row">${run('capital', 'allocation_report', 'Recommend allocation')}</div>`),
      section('Log money', `<form class="card" data-form="ledger"><div class="grid2"><label class="f">Amount ($)<input class="i" id="l-amt" type="number" step="0.01" required></label>
        <label class="f">Type<select class="i" id="l-cat">${['revenue', 'refund', 'ad_spend', 'software', 'fulfillment', 'fees'].map((c) => `<option>${c}</option>`).join('')}</select></label>
        <label class="f">Division<select class="i" id="l-div">${S.t('divisions').map((d) => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select></label>
        <label class="f">Note<input class="i" id="l-note" placeholder="e.g. Meta ads invoice"></label></div><button class="btn">Record as actual</button></form>`),
      section('Ledger', table([{ label: 'Date', get: (r) => r.occurred_on }, { label: 'Division', get: (r) => r.division }, { label: 'Type', get: (r) => r.category }, { label: 'Amount', num: true, html: (r) => `<span class="${r.category === 'revenue' ? 'up' : ''}">${money(r.amount_usd, 2)}</span>` },
        { label: 'Basis', html: (r) => chip(r.basis, r.basis === 'actual' ? 'ok' : 'est') }, { label: 'Source', html: (r) => `<span class="meta">${esc(r.source || '')}</span>` }], L, { empty: 'No money recorded yet.' })),
      section('How each number is calculated', `<dl class="facts">${Object.entries(M.DEFINITIONS).map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`),
      section('Agents', agentExplainer(S, ['finance', 'capital', 'learning'])),
    ].join('');
  },

  // ------------------------------------------------------------------ SETUP
  setup(S) {
    const st = S.t('settings')[0] || {};
    return [
      section('Connections', integrationList(S)),
      S.missing?.size ? `<div class="note err">These tables are missing (run the SQL migrations in Supabase): ${esc([...S.missing].join(', '))}</div>` : '',
      section('Global', `<div class="card"><div class="row between"><b>All agents</b>${st.paused ? chip('PAUSED', 'bad') : chip('running', 'ok')}</div>
        <div class="row"><button class="btn ${st.paused ? 'go' : 'danger solid'}" data-act="pause-all">${st.paused ? 'Resume everything' : 'Pause everything'}</button><span class="meta">Shortcut: <kbd>P</kbd></span></div></div>`),
      section('Display', `<div class="card"><div class="row">
        <button class="btn" data-act="mode" data-id="full">3D: full</button><button class="btn" data-act="mode" data-id="low">3D: low power</button><button class="btn" data-act="mode" data-id="off">2D only</button>
        <button class="btn" data-act="motion">Toggle reduced motion</button><button class="btn" data-act="replay-intro">Replay intro</button></div>
        <div class="meta">Your choice is remembered on this device.</div></div>`),
      section('Keyboard', `<dl class="facts"><dt><kbd>1</kbd>–<kbd>0</kbd></dt><dd>Jump to a station</dd><dt><kbd>/</kbd></dt><dd>Search</dd><dt><kbd>A</kbd></dt><dd>Approvals</dd><dt><kbd>P</kbd></dt><dd>Pause / resume everything</dd><dt><kbd>Esc</kbd></dt><dd>Close panel</dd><dt><kbd>?</kbd></dt><dd>This list</dd></dl>`),
      `<div class="row"><a class="btn ghost" href="classic.html">Open the classic town view</a><button class="btn ghost" data-act="signout">Sign out</button></div>`,
    ].join('');
  },
};

// ------------------------------------------------------------------ detail views
function prospectDetail(S, id) {
  const p = S.t('prospects').find((x) => String(x.id) === String(id));
  if (!p) return '<p class="muted">Not found.</p>';
  const msgs = S.t('outreach_messages').filter((m) => m.prospect_id === p.id);
  return `<button class="btn sm ghost" data-act="back">← All leads</button>
    <div class="row between"><h3 style="margin:0;font:600 20px var(--display)">${esc(p.name)}</h3>${statusChip(p.deal_stage)}</div>
    <dl class="facts"><dt>Category</dt><dd>${esc(p.category)}</dd><dt>Address</dt><dd>${esc(p.address)}</dd><dt>Phone</dt><dd>${esc(p.phone || '—')}</dd>
      <dt>Email</dt><dd>${esc(p.email || 'not found')}</dd><dt>Website</dt><dd>${p.website ? `<a href="${esc(p.website)}" target="_blank" rel="noopener">${esc(p.website)}</a>` : `none${p.verified_no_website ? ' (verified by search)' : ''}`}</dd>
      <dt>Lead score</dt><dd>${p.lead_score ?? '—'} ${p.scores ? `<span class="meta">fit ${p.scores.fit} · benefit ${p.scores.benefit} · economics ${p.scores.economics} · complexity ${p.scores.complexity}</span>` : ''}</dd>
      <dt>Opted out</dt><dd>${p.opted_out ? '<span class="down">yes: never contacted again</span>' : 'no'}</dd></dl>
    ${section('Sources', table([{ label: 'Field', get: (s) => s.field }, { label: 'Value', get: (s) => s.value || '—' }, { label: 'Source', html: (s) => s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.source)}</a>` : esc(s.source) }, { label: 'Seen', get: (s) => String(s.observed_at || '').slice(0, 10) }], p.contact_sources || []))}
    ${section('Problems found', (p.audit?.findings || []).length ? `<ul>${p.audit.findings.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : '<p class="muted">None recorded.</p>')}
    ${p.audit?.qa ? section('QA', `${p.audit.qa.passed ? chip('passed', 'ok') : chip('failed', 'bad')} <span class="meta">${esc(p.audit.qa.issues.join('; ') || 'no issues')}</span>`) : ''}
    ${p.comparison ? section('Private preview', `<img class="thumb" alt="Before and after preview" data-path="${esc(p.comparison)}">${p.new_html ? `<button class="btn sm" data-act="open-html" data-path="${esc(p.new_html)}">Open full page</button>` : ''}`) : ''}
    ${section('Outreach history', msgs.length ? `<div class="timeline">${msgs.map((m) => `<div class="ev"><time>${ct(m.created_at)}</time>${m.direction === 'in' ? '<b class="ops">Reply</b>' : `<b>${esc(m.kind)}</b>`} ${esc(m.subject || '')}</div>`).join('')}</div>` : '<p class="muted">No messages yet.</p>')}
    ${section('Workflow', workflowCard(S, firstWf(S, 'prospect', p.id, 'agency_lead')))}
    <div class="row">${run('designer', 'design_page', 'Redesign preview', { prospect_id: p.id })}${p.email ? run('postmaster', 'draft_email', 'Draft outreach', { prospect_id: p.id }) : run('caller', 'prepare_call', 'Prepare call script', { prospect_id: p.id, reason: 'owner request' })}
      ${['replied', 'meeting'].includes(p.deal_stage) ? run('postmaster', 'draft_proposal', 'Draft proposal', { prospect_id: p.id }) : ''}
      ${!p.opted_out ? `<button class="btn danger" data-act="optout" data-id="${p.id}">Do not contact</button>` : ''}</div>`;
}

function callDetail(S, id) {
  const c = S.t('call_tasks').find((x) => String(x.id) === String(id));
  if (!c) return '<p class="muted">Not found.</p>';
  const p = S.t('prospects').find((x) => x.id === c.prospect_id);
  const outcomes = ['no_answer', 'voicemail', 'wrong_number', 'declined', 'do_not_contact', 'interested', 'meeting_booked', 'proposal_requested', 'agreement_sent', 'agreement_signed', 'payment_received'];
  return `<button class="btn sm ghost" data-act="back">← Agency</button>
    <div class="row between"><h3 style="margin:0;font:600 20px var(--display)">Call ${esc(p?.name || '')}</h3>${statusChip(c.status)}</div>
    <dl class="facts"><dt>Phone</dt><dd><b>${esc(c.phone)}</b> <button class="btn sm" data-act="copy" data-text="${esc(c.phone)}">Copy</button></dd><dt>Goal</dt><dd>${esc(c.objective)}</dd>
      <dt>Calling hours</dt><dd>${esc(c.eligibility?.calling_hours || '')} ${c.eligibility?.in_hours_now === false ? '<span class="gold">(outside hours now)</span>' : ''}</dd>
      <dt>AI calling</dt><dd>${c.eligibility?.ai_allowed ? 'allowed' : `<span class="gold">off</span>: ${esc((c.eligibility?.reasons || []).join('; '))}`}</dd></dl>
    ${section('Script', `<div class="pre">${esc(c.script)}</div>`)}
    ${c.status === 'done' ? section('Report', `<div class="pre">${esc(JSON.stringify(c.report, null, 2))}</div>`) : `<form class="card" data-form="call-outcome" data-id="${c.id}">
      <label class="f">Outcome<select class="i" id="co-outcome">${outcomes.map((o) => `<option value="${o}">${o.replace(/_/g, ' ')}</option>`).join('')}</select></label>
      <label class="f">Notes (what they said, needs, objections)<textarea class="i" id="co-notes"></textarea></label>
      <div class="grid2"><label class="f">Their email (if given)<input class="i" id="co-email" type="email"></label><label class="f">Meeting time (if booked)<input class="i" id="co-meet" type="datetime-local"></label></div>
      <div class="note">A suggested time is not a booked meeting; choose "meeting booked" only when they agreed to a specific time.</div>
      <button class="btn primary">File call report</button></form>`}`;
}

function dealDetail(S, id) {
  const d = S.t('re_deals').find((x) => String(x.id) === String(id));
  if (!d) return '<p class="muted">Not found.</p>';
  const p = S.t('properties').find((x) => x.id === d.property_id) || {};
  const u = d.underwriting || {};
  const dl = S.t('deadlines').filter((x) => x.subject_type === 're_deal' && x.subject_id === d.id);
  const docs = S.t('deal_documents').filter((x) => x.subject_type === 're_deal' && x.subject_id === d.id);
  return `<button class="btn sm ghost" data-act="back">← All deals</button>
    <div class="row between"><h3 style="margin:0;font:600 20px var(--display)">${esc(p.address)}</h3>${statusChip(d.stage)}</div>
    <dl class="facts"><dt>Owner (public record)</dt><dd>${esc(p.owner?.name || '—')} <span class="meta">${esc(p.owner?.source || '')} ${String(p.owner?.observed_at || '').slice(0, 10)}</span></dd>
      <dt>Facts</dt><dd>${Object.entries(p.facts || {}).map(([k, v]) => `${esc(k)}: ${esc(v?.value ?? v)}`).join(' · ') || '—'}</dd>
      <dt>Seller said</dt><dd>${esc(JSON.stringify(d.seller_notes || {}))}</dd></dl>
    ${section('Underwriting', u.arv_range ? `<dl class="facts"><dt>Value range</dt><dd>${money(u.arv_range.low)} – ${money(u.arv_range.high)} (base ${money(u.arv_range.base)}, ${esc(u.arv_range.confidence)} confidence)</dd>
      <dt>Max offer</dt><dd><b class="gold">${money(d.max_offer_usd)}</b> <span class="meta">${esc(u.max_offer?.formula || '')}</span></dd>
      <dt>Downside</dt><dd>${esc(u.downside?.scenario || '')}: ${money(u.downside?.max_offer_if)}</dd>
      <dt>Repairs</dt><dd>${(u.repair_scenarios || []).map((r) => `${esc(r.name)} ${money(r.cost)}`).join(' · ')} <span class="meta">(needs contractor walkthrough)</span></dd>
      <dt>Assignment fee</dt><dd class="basis-forecast">${money(d.fee_estimate_usd)} estimate, not revenue</dd>
      <dt>Data</dt><dd class="meta">${esc(u.data_note || '')}</dd><dt>Needs</dt><dd>${esc((u.needs || []).join(', '))}</dd></dl>
      ${table([{ label: 'Comparable', get: (c) => c.address }, { label: 'Price', num: true, get: (c) => money(c.price) }, { label: 'Type', html: (c) => chip(c.price_type, 'est') }, { label: 'Sqft', num: true, get: (c) => c.sqft ?? '—' }, { label: 'Miles', num: true, get: (c) => c.distance_mi ?? '—' }, { label: 'Listed', get: (c) => String(c.listed || '').slice(0, 10) }], u.comps || [])}` : '<p class="muted">Not underwritten yet.</p>')}
    ${section('Deadlines', dl.length ? table([{ label: 'What', get: (x) => x.kind.replace(/_/g, ' ') }, { label: 'Due', get: (x) => ct(x.due_at) }, { label: 'Status', html: (x) => statusChip(x.status) }], dl) : '<p class="muted">Deadlines come from the executed contract.</p>')}
    ${section('Documents', docs.length ? table([{ label: 'Document', get: (x) => x.kind.replace(/_/g, ' ') }, { label: 'Template', get: (x) => x.template || '—' }, { label: 'Status', html: (x) => statusChip(x.status) }], docs) : '<p class="muted">None yet.</p>')}
    ${section('Workflow', workflowCard(S, firstWf(S, 're_deal', d.id, 're_deal')))}
    <div class="row">${run('re_underwrite', 'underwrite', 'Re-underwrite', { deal_id: d.id })}${run('re_deals', 'plan_outreach', 'Prepare seller outreach', { deal_id: d.id })}${run('re_deals', 'prepare_offer', 'Prepare offer for approval', { deal_id: d.id })}${run('re_buyers', 'match_buyers', 'Match buyers', { deal_id: d.id })}</div>
    ${section('Record a milestone (you confirm these)', `<form class="card" data-form="re-milestone" data-id="${d.id}">
      <label class="f">Milestone<select class="i" id="ms-kind"><option value="contract_executed">Contract executed (both signatures in hand)</option><option value="closed_funds_received">Closed: assignment fee received</option><option value="cancelled">Cancelled</option></select></label>
      <div class="grid2"><label class="f">Contract price ($)<input class="i" id="ms-price" type="number"></label><label class="f">Option period ends<input class="i" id="ms-option" type="datetime-local"></label>
        <label class="f">Closing date<input class="i" id="ms-closing" type="datetime-local"></label><label class="f">Fee collected ($)<input class="i" id="ms-fee" type="number"></label></div>
      <label class="f">Note / reason<input class="i" id="ms-note"></label>
      <div class="note warn">The system never signs, sends earnest money, or changes wiring instructions. Verify wiring instructions by phone with the title company.</div>
      <button class="btn gold">Record</button></form>`)}`;
}

function convDetail(S, id) {
  const c = S.t('conversations').find((x) => String(x.id) === String(id));
  if (!c) return '<p class="muted">Not found.</p>';
  const msgs = S.t('messages').filter((m) => m.conversation_id === c.id).sort((a, b) => a.created_at.localeCompare(b.created_at));
  const pend = S.t('approvals').filter((a) => a.kind === 'reply' && a.payload?.conversation_id === c.id && a.status === 'pending');
  return `<button class="btn sm ghost" data-act="back">← Inbox</button>
    <div class="row between"><h3 style="margin:0;font:600 20px var(--display)">${esc(c.subject || 'Conversation')}</h3>${statusChip(c.status)}</div>
    <div class="timeline">${msgs.map((m) => `<div class="ev"><time>${ct(m.created_at)}</time><b class="${m.direction === 'in' ? 'ops' : ''}">${m.direction === 'in' ? esc(m.sender) : 'Us'}</b>${m.classification ? ` ${chip(m.classification)}` : ''}<div class="pre">${esc(m.body)}</div></div>`).join('')}</div>
    ${pend.map((a) => approvalCard(a, S)).join('')}
    <div class="row"><button class="btn sm" data-act="conv-status" data-id="${c.id}" data-status="resolved">Mark resolved</button><button class="btn sm" data-act="conv-status" data-id="${c.id}" data-status="escalated">Escalate to me</button></div>`;
}
