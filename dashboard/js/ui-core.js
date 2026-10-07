// Shared UI building blocks: escaping, formatting, cards, approval cards, agent explanations.
import { money } from './metrics.js';
import { APPROVAL_EXPLAIN, termsIn } from './explain.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const ago = (iso) => {
  if (!iso) return '—';
  const m = Math.round((Date.now() - new Date(iso)) / 60000);
  if (m < 0) { const f = -m; return f < 60 ? `in ${f}m` : f < 1440 ? `in ${Math.round(f / 60)}h` : `in ${Math.round(f / 1440)}d`; }
  return m < 1 ? 'just now' : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};
export const ct = (iso, opts = {}) => iso ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...opts }) : '—';
export const chip = (text, kind = '') => `<span class="chip ${kind}">${esc(text)}</span>`;

export function md(text) {
  const lines = esc(text || '').split('\n');
  let out = '', list = false;
  const inline = (s) => s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/(^|\s)(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  for (const l of lines) {
    const li = l.match(/^\s*[-*]\s+(.*)/);
    if (li) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(li[1])}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    const h = l.match(/^#{1,4}\s+(.*)/);
    if (h) out += `<h3>${inline(h[1])}</h3>`; else if (l.trim()) out += `<p>${inline(l)}</p>`;
  }
  return `<div class="md">${out}${list ? '</ul>' : ''}</div>`;
}

export const kpi = (label, value, basis = 'actual', title = '') =>
  `<div class="kpi" ${title ? `title="${esc(title)}"` : ''}><div class="v ${basis === 'na' ? 'faint' : ''}">${value}</div><div class="l">${esc(label)}</div><div class="b basis-${basis}">${{ actual: 'actual', estimated: 'estimate', forecast: 'pipeline · not revenue', na: 'not connected' }[basis] || basis}</div></div>`;

export const section = (title, body, aside = '') => `<section class="section"><h3>${esc(title)}${aside ? `<small>${aside}</small>` : ''}</h3>${body}</section>`;

export const statusChip = (s) => {
  const map = { connected: 'ok', needs_setup: 'warn', unverified: 'ops', error: 'bad', disabled: '', active: 'ok', blocked: 'bad', waiting_approval: 'warn', paused: 'warn', won: 'ok', lost: '', done: 'ok',
    pending: 'warn', approved: 'ops', executed: 'ok', rejected: '', failed: 'bad', held: 'warn', expired: '', changes_requested: 'warn',
    exception: 'bad', fulfilling: 'ops', shipped: 'ops', delivered: 'ok', refunded: 'bad', new: 'ops', idle: '', working: 'ops' };
  return chip(String(s || '').replace(/_/g, ' '), map[s] ?? '');
};

export function table(cols, rows, { onRow = null, empty = 'Nothing yet.' } = {}) {
  if (!rows.length) return `<p class="muted">${esc(empty)}</p>`;
  return `<div class="tw"><table class="t"><thead><tr>${cols.map((c) => `<th class="${c.num ? 'num' : ''}">${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) =>
    `<tr ${onRow ? `class="click" data-act="${onRow.act}" data-id="${esc(onRow.id(r))}"` : ''}>${cols.map((c) => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.get(r))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

const FIELD_LABELS = { to: 'To', subject: 'Subject', body: 'Message', text: 'Post', title: 'Title', price_usd: 'Price ($)', description: 'Description', deposit_usd: 'Deposit ($)', budget_usd: 'Budget ($)' };

/** A full approval card: what, why, evidence, exact content, money at risk, scope, reversibility, and the five actions. */
export function approvalCard(a, S) {
  const p = a.payload || {};
  const editable = a.status === 'pending' || a.status === 'held';
  const fields = Object.keys(FIELD_LABELS).filter((k) => typeof p[k] === 'string' || typeof p[k] === 'number');
  const content = fields.map((k) => {
    const v = p[k];
    const big = k === 'body' || k === 'text' || k === 'description';
    return `<label class="f">${FIELD_LABELS[k]}${big ? `<textarea class="i" data-f="${k}" ${editable ? '' : 'disabled'}>${esc(v)}</textarea>` : `<input class="i" data-f="${k}" value="${esc(v)}" ${typeof v === 'number' ? 'type="number" step="0.01"' : ''} ${editable ? '' : 'disabled'}>`}</label>`;
  }).join('');
  const extra = [];
  if (a.standing || p.rules) extra.push(`<div><div class="meta">Standing limits (apply to every routine action)</div><div class="pre">${esc(JSON.stringify(p.rules || {}, null, 2))}</div></div>`);
  if (p.economics) extra.push(`<details class="x"><summary>Economics (estimates)</summary><div class="pre">${esc(JSON.stringify(p.economics, null, 2))}</div></details>`);
  if (p.memo) extra.push(`<details class="x"><summary>Investment memo</summary>${md(p.memo)}</details>`);
  if (p.deliverables) extra.push(`<div class="meta">Deliverables: ${esc(p.deliverables.join('; '))}</div>`);
  if (p.disclosure) extra.push(`<div class="note warn">${esc(p.disclosure)}</div>`);
  if (p.plan_text) extra.push(`<div><div class="meta">The plan</div><div class="pre">${esc(p.plan_text)}</div></div>`);
  if (p.url && a.kind === 'site_publish') extra.push(`<div class="meta">Will go live at: ${esc(p.url)}</div>`);
  const ev = Array.isArray(a.evidence) ? a.evidence : [];
  const res = a.result?.revisions ? (a.result?.waiting || a.result?.error) : (a.result?.note || a.result?.waiting || a.result?.error);
  const agent = S.t('agents').find((x) => x.id === a.agent_id);
  return `<article class="card ${a.status === 'pending' ? 'prio' : ''} ${a.status === 'failed' ? 'err' : ''}" data-appr="${a.id}">
    <div class="row between"><h4>${esc(a.title)}</h4>${statusChip(a.status)}</div>
    <div class="meta">${esc(agent?.name || a.agent_id || '')} · ${ago(a.created_at)}${a.expires_at ? ` · expires ${ago(a.expires_at)}` : ''}${a.standing ? ' · STANDING APPROVAL' : ''}</div>
    <div class="plain"><b>In plain English:</b> ${esc(a.explain || APPROVAL_EXPLAIN[a.kind] || 'Approving lets the agent take the action described below, exactly as written.')}${a.explain && APPROVAL_EXPLAIN[a.kind] ? `<div class="meta" style="margin-top:4px">${esc(APPROVAL_EXPLAIN[a.kind])}</div>` : ''}
      ${(() => { const t = termsIn([a.title, a.reason, a.scope, a.expected_outcome, a.uncertainty].join(' '), 5); return t.length ? `<details class="x"><summary>Words used here</summary><dl class="facts">${t.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''; })()}</div>
    ${a.status === 'revising' || a.status === 'changes_requested' ? `<div class="note warn">✎ ${a.status === 'revising' ? 'Revising per your note' : 'Waiting for the agent to start revising'}… <span class="elapsed" data-since="${esc(a.result?.revising_since || a.decided_at || a.created_at)}"></span> <span class="faint">(usually 5–20 seconds)</span>${a.decision_note ? `<br><span class="faint">Your note: “${esc(a.decision_note.slice(0, 200))}”</span>` : ''}${a.result?.revise_error ? `<br><span class="down">${esc(a.result.revise_error)}</span>` : ''}</div>` : ''}
    ${a.status === 'pending' && a.result?.revisions?.length ? `<div class="note">✓ ${esc(a.result.note || 'Revised')}</div>` : ''}
    ${a.reason ? `<div><b>Why:</b> ${esc(a.reason)}</div>` : ''}
    <dl class="facts">
      <dt>Cost</dt><dd>${money(a.cost_usd, 2)}</dd>
      <dt>Max exposure</dt><dd>${money(a.max_exposure_usd, 2)}</dd>
      ${a.expected_outcome ? `<dt>Expected</dt><dd>${esc(a.expected_outcome)}</dd>` : ''}
      ${a.uncertainty ? `<dt>Uncertainty</dt><dd>${esc(a.uncertainty)}</dd>` : ''}
      ${a.scope ? `<dt>Scope</dt><dd>${esc(a.scope)}</dd>` : ''}
      <dt>Reversible</dt><dd>${a.reversible === false ? '<span class="down">No, can\'t be undone</span>' : 'Yes'}</dd>
    </dl>
    ${ev.length ? `<details class="x"><summary>Evidence (${ev.length})</summary><ul>${ev.slice(0, 12).map((e) => `<li class="meta">${esc(e.claim || e.fact || e.value || e.field || JSON.stringify(e)).slice(0, 220)}${e.source || e.source_url || e.url ? ` — ${esc(e.source || e.source_url || e.url)}` : ''}${e.observed_at || e.observed_on || e.date ? ` (${esc(String(e.observed_at || e.observed_on || e.date).slice(0, 10))})` : ''}</li>`).join('')}</ul></details>` : ''}
    ${a.preview ? `<img class="thumb" alt="Preview attached to this item" data-path="${esc(a.preview)}">` : ''}
    ${content}${extra.join('')}
    ${a.decision_note ? `<div class="note">${esc(a.decision_note)}</div>` : ''}
    ${res ? `<div class="note ${a.status === 'failed' ? 'err' : ''}">${esc(res)}</div>` : ''}
    ${a.status === 'approved' ? (() => {
      const hb = S.t('integrations').find((i) => i.id === 'approvals_runner');
      const age = hb?.checked_at ? (Date.now() - new Date(hb.checked_at)) / 60000 : null;
      const stale = age == null || age > 3;
      return `<div class="note ${stale ? 'err' : ''}">${res ? '' : '⏳ Approved and queued. '}${hb?.checked_at ? `The worker last checked approved items ${ago(hb.checked_at)}.` : 'The worker hasn\'t reported checking approved items yet (it may still be on older code).'}${stale ? ' It should check every minute: if this stays stale, restart the worker (Railway → your service → Deployments → ⋮ on the newest one → Restart).' : ''}${a.result?.checked_at ? ` Last attempt on this item: ${ago(a.result.checked_at)}.` : ''}</div>`;
    })() : ''}
    ${a.status === 'approved' && !/Connect Gmail|Connection timeout|mail server/i.test(res || '') ? '' : /Connect Gmail|Connection timeout|mail server/i.test(res || '') ? gmailConnectBox(S) : ''}
    ${a.status === 'failed' ? `<div class="row"><button class="btn sm" data-act="retry-approval" data-id="${a.id}">Try again</button><span class="meta">Safe: if it never reached the provider it runs once; if it might have, it stops and tells you.</span></div>` : ''}
    ${editable ? `<div class="row">
      <button class="btn go" data-act="approve" data-id="${a.id}">Approve</button>
      <button class="btn" data-act="save-edit" data-id="${a.id}">Save edits</button>
      <button class="btn" data-act="changes" data-id="${a.id}">Request changes</button>
      <button class="btn danger" data-act="reject" data-id="${a.id}">Reject</button>
      ${a.workflow_id ? `<button class="btn ghost" data-act="pause-wf" data-id="${a.workflow_id}">Pause workflow</button>` : ''}
    </div>` : ''}
    ${a.status === 'executed' && (a.result?.url || p.url) ? `<div class="row"><a class="btn sm gold" href="${esc(a.result?.url || p.url)}" target="_blank" rel="noopener">Open the live link ↗</a><span class="meta">${esc(a.result?.url || p.url)}</span></div>` : ''}
    ${a.status === 'executed' && ['social_post', 'content'].includes(a.kind) && a.result?.manual !== false ? `<div class="meta">Posted it yourself? Add the link in <button class="lnk" data-act="goto" data-id="links">Live Links</button> so its numbers are tracked.</div>` : ''}
    ${a.status === 'executed' && (p.text || p.body) && a.result?.manual ? `<button class="btn sm" data-act="copy" data-text="${esc(p.text || p.body)}">Copy text</button>` : ''}
  </article>`;
}

/** "What is each agent doing and why": status, current job, the workflow it serves, and its last actions. */
export function agentExplainer(S, agentIds) {
  const agents = S.t('agents').filter((a) => agentIds.includes(a.id));
  if (!agents.length) return '<p class="muted">No agents in this division yet. Run the latest database migration.</p>';
  return agents.map((a) => {
    const wfs = S.t('workflows').filter((w) => w.owner_agent === a.id && ['active', 'waiting_approval', 'blocked'].includes(w.status)).slice(0, 3);
    const evs = S.t('events').filter((e) => e.agent_id === a.id).slice(0, 4);
    return `<details class="card"><summary class="row between" style="cursor:pointer;list-style:none"><span><b>${esc(a.name)}</b> <span class="meta">${esc(a.current_task || a.role || '')}</span></span>${statusChip(a.status)}</summary>
      <div class="meta">${esc(a.role || '')}</div>
      ${wfs.length ? `<div><b>Working toward:</b><ul>${wfs.map((w) => `<li>${esc(w.objective)} — <span class="muted">stage ${esc(w.stage)}; next: ${esc(w.next_action || '—')}${w.blockers ? `; blocked: ${esc(w.blockers)}` : ''}</span></li>`).join('')}</ul></div>` : '<div class="muted">No open workflow assigned right now.</div>'}
      ${evs.length ? `<div class="timeline">${evs.map((e) => `<div class="ev"><time>${ct(e.created_at, { month: undefined, day: undefined })}</time>${esc(e.message)}</div>`).join('')}</div>` : ''}
    </details>`;
  }).join('');
}

export function workflowCard(S, wf) {
  if (!wf) return '';
  const evs = S.t('workflow_events').filter((e) => e.workflow_id === wf.id).slice(0, 12);
  const owner = S.t('agents').find((a) => a.id === wf.owner_agent);
  return `<div class="card ${wf.status === 'blocked' ? 'err' : ''}">
    <div class="row between"><h4>${esc(wf.objective)}</h4>${statusChip(wf.status)}</div>
    <dl class="facts">
      <dt>Division</dt><dd>${esc(wf.division)}</dd><dt>Stage</dt><dd>${esc(wf.stage)}</dd><dt>Owner</dt><dd>${esc(owner?.name || wf.owner_agent || '—')}</dd>
      <dt>Next</dt><dd>${esc(wf.next_action || '—')}</dd>
      <dt>Cost</dt><dd>${money(wf.cost_usd, 2)}${Number(wf.budget_usd) ? ` of ${money(wf.budget_usd, 2)} budget (${money(wf.budget_usd - wf.cost_usd, 2)} left)` : ''}</dd>
      ${wf.blockers ? `<dt>Blocked</dt><dd class="down">${esc(wf.blockers)}</dd>` : ''}${wf.recovery ? `<dt>To fix</dt><dd>${esc(wf.recovery)}</dd>` : ''}
    </dl>
    ${(wf.evidence || []).length ? `<details class="x"><summary>Evidence (${wf.evidence.length})</summary><ul>${wf.evidence.slice(0, 10).map((e) => `<li class="meta">${esc(e.claim)} — ${esc(e.source || '')} ${e.observed_at ? `(${esc(String(e.observed_at).slice(0, 10))})` : ''}</li>`).join('')}</ul></details>` : ''}
    ${evs.length ? `<details class="x"><summary>Audit trail (${evs.length})</summary><div class="timeline">${evs.map((e) => `<div class="ev"><time>${ct(e.created_at)}</time>${esc(e.message)}${Number(e.cost_usd) ? ` <span class="faint">(${money(e.cost_usd, 3)})</span>` : ''}</div>`).join('')}</div></details>` : ''}
    <div class="row">${wf.status === 'paused' ? `<button class="btn sm" data-act="resume-wf" data-id="${wf.id}">Resume</button>` : `<button class="btn sm ghost" data-act="pause-wf" data-id="${wf.id}">Pause</button>`}</div>
  </div>`;
}

/** "Connect Gmail" button plus the single-use Google sign-in link once the worker has prepared it. */
export function gmailConnectBox(S) {
  const c = S.t('commands').find((x) => x.kind === 'gmail_connect');
  const link = c?.result?.url ? `<a class="btn sm primary" href="${esc(c.result.url)}" target="_blank" rel="noopener">Open Google sign-in →</a><span class="meta">Sign in as agentickj@gmail.com and allow “Send email”. The link works once, for 15 minutes.</span>`
    : c && ['queued', 'running'].includes(c.status) && Date.now() - new Date(c.created_at) > 90000 ? `<span class="down meta">The worker hasn't picked this up after ${Math.round((Date.now() - new Date(c.created_at)) / 60000) || 1} min. Check the worker light at the top: if it's red, the worker is down (Railway → your service → Deployments → View logs, and send me the last red lines). If it's green, click Connect Gmail again.</span>`
    : c && ['queued', 'running'].includes(c.status) ? '<span class="meta">Preparing the sign-in link… (up to a minute)</span>'
    : c?.status === 'failed' ? `<span class="down meta">${esc(c.result?.error || 'Could not prepare the link')}</span>` : '';
  // Preferred: a direct link to the worker's sign-in page (opens Google immediately, no waiting).
  const pub = S.t('integrations').find((i) => i.id === 'public_url' && i.status === 'connected')?.detail;
  if (pub && /^https?:\/\//.test(pub)) return `<div class="row"><a class="btn sm gold" href="${esc(pub.replace(/\/$/, ''))}/oauth/gmail/start" target="_blank" rel="noopener">Connect Gmail →</a><span class="meta">Opens Google in a new tab. Sign in as agentickj@gmail.com and allow “Send email”. If the tab shows an error, that message says what's missing.</span></div>`;
  return `<div class="row"><button class="btn sm gold" data-act="gmail-connect">Connect Gmail</button>${link}</div>`;
}

export function integrationList(S, ids) {
  const rows = S.t('integrations').filter((i) => !ids || ids.includes(i.id));
  if (!rows.length) return '<p class="muted">Status appears after the worker\'s first check.</p>';
  return rows.map((i) => `<div class="card ${i.status === 'error' ? 'err' : ''}"><div class="row between"><b>${esc(i.name)}</b>${statusChip(i.status)}</div>
    ${i.detail ? `<div class="meta">${esc(i.detail)}</div>` : ''}${i.id === 'gmail' && i.status !== 'connected' ? gmailConnectBox(S) : ''}${i.status !== 'connected' && i.setup_steps ? `<details class="x"><summary>How to connect</summary><div class="note">${esc(i.setup_steps)}</div></details>` : ''}
    <div class="faint" style="font-size:11px">checked ${ago(i.checked_at)}</div></div>`).join('');
}
