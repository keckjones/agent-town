// Panels for the trading floor: desk inspector, record viewer, Big Boss office, All Agents monitor,
// view modes (Money, Workflow, Customer, Content Studio, System Health), expanded walls, timeline, "since last visit".
// Everything shown is a recorded fact with a link to its row. Agent "reasoning" is never shown: only recorded actions,
// evidence and the decision summaries agents wrote into approvals/workflows.
import { esc, ago, ct, chip, md, kpi, section, statusChip, table, approvalCard, workflowCard, integrationList } from './ui-core.js';
import * as M from './metrics.js';
import * as F from './floor-model.js';
import { PANELS } from './panels.js';
import { AGENT_EXPLAIN, TASK_EXPLAIN, termsIn } from './explain.js';

const money = M.money;
const n = (v) => Number(v || 0);
const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
export const refBtn = (ref, text, cls = 'lnk') => `<button class="${cls}" data-act="ref" data-ref="${esc(ref)}">${esc(text)}</button>`;
export const statusTag = (key, extra = '') => { const s = F.STATUS[key] || F.STATUS.idle; return `<span class="stag" style="--c:${s.color}">${s.icon} ${esc(s.label)}${extra}</span>`; };
const dur = (fromIso, toIso) => { if (!fromIso) return '—'; const m = Math.max(0, Math.round(((toIso ? ms(toIso) : Date.now()) - ms(fromIso)) / 60000)); return m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${Math.round(m / 1440)}d`; };
const agentName = (S, id) => S.t('agents').find((a) => a.id === id)?.name || id || '—';
const deptName = (id) => F.deptById[id]?.name || id;
const subjectRef = (type, id) => ({ prospect: `prospect:${id}`, order: `order:${id}`, re_deal: `deal:${id}`, content: `content:${id}`, brand: `brand:${id}`, product: `product:${id}`, opportunity: `opportunity:${id}` }[type]);

// ------------------------------------------------------------------ department strip (top of every station)
export function deptStrip(S, ctx, deptId) {
  const dept = F.deptById[deptId]; if (!dept) return '';
  const desks = Object.values(ctx.desks).filter((d) => d.dept === deptId);
  const w = ctx.workload[deptId] || {};
  const biz = S.t('divisions').find((d) => d.id === F.businessOf(deptId));
  const paused = biz?.status === 'paused';
  return `<div class="deskstrip">
    <div class="row between"><span class="meta">${desks.length} desks · ${w.working || 0} working · ${w.queued || 0} queued · ${w.needs || 0} need you · ${w.blocked || 0} blocked</span>
      ${biz ? `<button class="btn sm ${paused ? 'go' : 'danger'}" data-act="pause-business" data-id="${biz.id}" data-to="${paused ? 'active' : 'paused'}">${paused ? 'Resume this business' : 'Pause this business'}</button>` : ''}</div>
    ${paused ? '<div class="note warn">This business is paused: its agents take no new work and approved items for it wait.</div>' : ''}
    <div class="desks">${desks.map((d) => `<button class="deskchip" data-act="desk" data-id="${d.id}" style="--c:${d.color}"><span class="i">${d.icon}</span><span class="nm">${esc(d.name)}</span><span class="tk">${esc(d.statusLabel)}${d.task ? ` · ${esc(String(d.task).slice(0, 60))}` : ''}</span>${d.needsYou ? '<span class="ny">needs you</span>' : ''}</button>`).join('')}</div>
  </div>`;
}

// ------------------------------------------------------------------ desk inspector
export function deskPanel(S, ui, ctx) {
  const id = ui.sub?.agent;
  const d = ctx.desks[id];
  const a = S.t('agents').find((x) => x.id === id);
  if (!d || !a) return '<p class="muted">This agent is not in the database.</p>';
  const wf = S.t('workflows').find((w) => w.id === d.workflow);
  const tasks = S.t('tasks').filter((t) => t.agent_id === id).sort((x, y) => ms(y.created_at) - ms(x.created_at));
  const running = tasks.find((t) => t.status === 'running');
  const failed = tasks.find((t) => t.status === 'failed');
  const evs = S.t('events').filter((e) => e.agent_id === id).slice(0, 10);
  const wfEvents = wf ? S.t('workflow_events').filter((e) => e.workflow_id === wf.id).sort((x, y) => ms(x.created_at) - ms(y.created_at)) : [];
  const latest = [evs[0]?.created_at, wfEvents[wfEvents.length - 1]?.created_at, tasks[0]?.finished_at].filter(Boolean).sort().pop();
  const appr = S.t('approvals').filter((x) => x.agent_id === id && ['pending', 'changes_requested', 'held'].includes(x.status));
  const subj = running ? F.taskSubject(S, running) : wf?.subject_type ? { type: wf.subject_type, id: wf.subject_id, name: F.subjectName(S, wf.subject_type, wf.subject_id) } : null;
  const usage = S.t('usage').filter((u) => u.agent_id === id);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const costToday = usage.filter((u) => ms(u.created_at) >= today.getTime()).reduce((s, u) => s + n(u.cost_usd), 0);
  const cost7 = usage.filter((u) => ms(u.created_at) >= Date.now() - 7 * 864e5).reduce((s, u) => s + n(u.cost_usd), 0);
  const plan = wf ? F.STAGE_PLAN[wf.kind] : null;
  const stageIdx = plan ? plan.indexOf(wf.stage) : -1;
  const doneStages = wfEvents.filter((e) => ['stage', 'result', 'handoff', 'approval'].includes(e.type));
  const sameDept = S.t('agents').filter((x) => x.division === a.division && x.id !== a.id);
  const prospect = subj?.type === 'prospect' ? S.t('prospects').find((p) => String(p.id) === String(subj.id)) : null;
  const content = subj?.type === 'content' ? S.t('content_items').find((c) => String(c.id) === String(subj.id)) : null;
  const evidence = [...(wf?.evidence || []), ...(prospect?.contact_sources || []).map((c) => ({ claim: `${c.field}: ${c.value}`, source: c.source || c.url, observed_at: c.observed_at })), ...appr.flatMap((x) => (Array.isArray(x.evidence) ? x.evidence : []))];
  const docs = S.t('documents').filter((x) => x.agent_id === id).slice(0, 3);
  const recommendation = appr[0] ? [appr[0].reason, appr[0].expected_outcome && `Expected: ${appr[0].expected_outcome}`, appr[0].uncertainty && `Uncertainty: ${appr[0].uncertainty}`].filter(Boolean).join(' · ')
    : wf?.next_action ? `Next step on record: ${wf.next_action}` : null;
  const biz = S.t('divisions').find((x) => x.id === F.businessOf(d.dept));
  return [
    `<div class="card hero" style="--c:${d.color}">
      <div class="row between"><div><div class="meta">${esc(a.role || '')}</div><div class="meta">${esc(deptName(d.dept))}${a.id === 'manager' ? ' · <b class="gold">Big Boss Manager</b>' : ''}${d.isCeo ? ' · CEO agent' : ''}</div></div>${statusTag(d.status)}</div>
      <dl class="facts">
        <dt>Doing</dt><dd>${esc(d.task || '—')}</dd>
        <dt>Why this status</dt><dd>${d.why.map(esc).join('<br>')}</dd>
        ${d.since ? `<dt>${d.status === 'working' ? 'Working for' : 'Since'}</dt><dd>${dur(d.since)} <span class="faint">(${ct(d.since)})</span></dd>` : ''}
        <dt>Latest update</dt><dd>${latest ? `${ago(latest)} <span class="faint">(${ct(latest)})</span>` : '—'}</dd>
        <dt>Next</dt><dd>${esc(d.next || '—')}${d.nextAt ? ` <span class="faint">(${ct(d.nextAt)})</span>` : ''}</dd>
        ${d.needsYou ? `<dt>Needs you</dt><dd class="gold">${esc(d.needsYou)}</dd>` : ''}
      </dl>
      <div class="row">
        ${a.enabled === false ? `<button class="btn sm go" data-act="agent-enable" data-id="${a.id}" data-on="1">Resume agent</button>` : `<button class="btn sm" data-act="agent-enable" data-id="${a.id}" data-on="0">Pause agent</button>`}
        ${failed && d.status === 'blocked' ? `<button class="btn sm" data-act="retry" data-id="${failed.id}">Retry failed task</button>` : ''}
        ${wf ? refBtn(`workflow:${wf.id}`, 'Open workflow', 'btn sm') : ''}
        ${wf && wf.status !== 'paused' ? `<button class="btn sm ghost" data-act="pause-wf" data-id="${wf.id}">Pause workflow</button>` : ''}
        ${wf && sameDept.length ? `<select class="i sm" id="reassign-${wf.id}" aria-label="Reassign to"><option value="">Reassign workflow to…</option>${sameDept.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join('')}</select><button class="btn sm" data-act="reassign" data-id="${wf.id}">Reassign</button>` : ''}
        <button class="btn sm ghost" data-act="watch" data-id="${a.id}">Watch on floor</button>
      </div>
      ${biz?.status === 'paused' ? '<div class="note warn">This business is paused.</div>' : ''}
    </div>`,
    plainEnglish(S, d, a, running || tasks[0], wf, appr),
    section('Current assignment', wf ? `<dl class="facts"><dt>Purpose</dt><dd>${refBtn(`workflow:${wf.id}`, wf.objective)}</dd><dt>Stage</dt><dd>${esc(F.stageLabel(wf.stage))} ${statusChip(wf.status)}</dd>
      ${subj?.name ? `<dt>Involves</dt><dd>${subjectRef(subj.type, subj.id) ? refBtn(subjectRef(subj.type, subj.id), subj.name) : esc(subj.name)}</dd>` : ''}
      ${wf.blockers ? `<dt>Blocker</dt><dd class="down">${esc(wf.blockers)}</dd>` : ''}${wf.recovery ? `<dt>To fix</dt><dd>${esc(wf.recovery)}</dd>` : ''}</dl>`
      : subj?.name ? `<dl class="facts"><dt>Involves</dt><dd>${subjectRef(subj.type, subj.id) ? refBtn(subjectRef(subj.type, subj.id), subj.name) : esc(subj.name)}</dd></dl>` : '<p class="muted">No open workflow assigned to this agent.</p>'),
    plan || doneStages.length ? section('Steps', `<div class="steps">${doneStages.map((e) => `<div class="st done"><span>✓</span><div>${esc(e.message)}<div class="faint">${agentName(S, e.agent_id)} · ${ct(e.created_at)}</div></div></div>`).join('')}
      ${plan && stageIdx >= 0 ? plan.slice(stageIdx + 1).map((s) => `<div class="st todo"><span>○</span><div>${esc(F.stageLabel(s))}</div></div>`).join('') : ''}</div>
      ${plan ? '<div class="faint" style="font-size:11px">Remaining steps come from the workflow\'s planned sequence; not every lead goes through every step.</div>' : ''}`) : '',
    appr.length ? section(`Waiting for your decision (${appr.length})`, appr.map((x) => approvalCard(x, S)).join('')) : '',
    prospect && (prospect.old_screenshot || prospect.new_screenshot) ? section('Output: website preview', `<div class="grid2">${prospect.old_screenshot ? `<figure><img class="thumb" data-path="${esc(prospect.old_screenshot)}" alt="Their current site"><figcaption class="meta">Current site</figcaption></figure>` : ''}${prospect.new_screenshot ? `<figure><img class="thumb" data-path="${esc(prospect.new_screenshot)}" alt="Our preview"><figcaption class="meta">Our private preview</figcaption></figure>` : ''}</div>${prospect.new_html ? `<button class="btn sm" data-act="open-html" data-path="${esc(prospect.new_html)}">Open preview</button>` : ''}`) : '',
    content ? section('Output: content', contentCard(S, content)) : '',
    docs.length ? section('Documents written', docs.map((x) => `<details class="card"><summary class="row between" style="cursor:pointer"><b>${esc(x.title)}</b><span class="meta">${ago(x.created_at)}</span></summary>${md(x.body)}</details>`).join('')) : '',
    evidence.length ? section(`Sources & evidence (${evidence.length})`, `<ul class="src">${evidence.slice(0, 15).map((e) => `<li>${esc(String(e.claim || e.fact || e.field || '').slice(0, 200))}${e.source || e.source_url || e.url ? ` — ${/^https?:/.test(e.source || e.source_url || e.url) ? `<a href="${esc(e.source || e.source_url || e.url)}" target="_blank" rel="noopener">${esc(e.source || e.source_url || e.url)}</a>` : esc(e.source || e.source_url || e.url)}` : ''}${e.observed_at || e.observed_on ? ` <span class="faint">(${esc(String(e.observed_at || e.observed_on).slice(0, 10))})</span>` : ''}</li>`).join('')}</ul>`) : '',
    recommendation ? section('Recommendation (as recorded)', `<p>${esc(recommendation)}</p>`) : '',
    section('Tools & execution results', tasks.length ? table([
      { label: 'Task', html: (t) => `${refBtn(`task:${t.id}`, F.VERBS[t.kind] || t.kind)}<div class="faint">#${t.id} · ${esc(t.created_by || '')}</div>` },
      { label: 'Status', html: (t) => statusChip(t.status === 'done' ? 'done' : t.status) },
      { label: 'Time', get: (t) => (t.started_at ? dur(t.started_at, t.finished_at) : t.status === 'queued' ? `starts ${ago(t.run_after)}` : '—') },
      { label: 'Result', html: (t) => (t.error ? `<span class="down">${esc(t.error.slice(0, 120))}</span>` : t.result ? `<span class="meta">${esc(JSON.stringify(t.result).slice(0, 120))}</span>` : '') },
    ], tasks.slice(0, 8)) : '<p class="muted">No tasks recorded for this agent yet.</p>'),
    section('Costs', `<div class="kpis">${kpi('AI today', money(costToday, 2), 'estimated')}${kpi('AI 7 days', money(cost7, 2), 'estimated')}${wf ? kpi('Workflow cost', money(wf.cost_usd, 2) + (n(wf.budget_usd) ? ` / ${money(wf.budget_usd, 2)}` : ''), 'estimated') : ''}</div>`),
    d.waitingOn.length || d.needsYou ? section('Dependencies', `<ul class="src">${d.waitingOn.map((w) => `<li>Waiting on ${refBtn(`agent:${w.agent}`, agentName(S, w.agent))}: ${esc(w.reason)} (${refBtn(`task:${w.task}`, `task #${w.task}`)})</li>`).join('')}${d.needsYou ? `<li class="gold">Waiting on you: ${esc(d.needsYou)}</li>` : ''}</ul>`) : '',
    section('Next scheduled action', `<p>${esc(d.next || 'Nothing scheduled.')}${d.nextAt ? ` <span class="faint">(${ct(d.nextAt)})</span>` : ''}</p>${F.SCHEDULES[id] ? `<div class="meta">Recurring: ${esc(F.SCHEDULES[id])}</div>` : ''}`),
    section('Recorded actions', evs.length ? `<div class="timeline">${evs.map((e) => `<div class="ev"><time>${ct(e.created_at)}</time>${refBtn(`event:${e.id}`, e.message, `lnk ${e.level === 'error' ? 'down' : e.level === 'warn' ? 'gold' : ''}`)}</div>`).join('')}</div>` : '<p class="muted">No recorded actions yet.</p>'),
  ].join('');
}

/** "In plain English": what this agent is for, what it's doing right now, what happens next, and the jargon defined. */
function plainEnglish(S, d, a, task, wf, appr) {
  const doing = task && (task.status === 'running' || d.status === 'working') ? TASK_EXPLAIN[task.kind] : null;
  const last = task && !doing ? TASK_EXPLAIN[task.kind] : null;
  const status = {
    working: 'It is working on this right now.', scheduled: 'Nothing is running right now; its next job is already on the schedule.',
    waiting_agent: 'It is waiting for another agent to finish their part before it can continue.', waiting_external: 'It is waiting on someone outside the company (a customer, supplier or platform) to respond.',
    needs_approval: 'It finished its part and is waiting for you to decide.', blocked: 'Something went wrong or a check failed, so it stopped instead of guessing. The details below say what and how to fix it.',
    idle: 'It has no task right now and will start again when its next job is scheduled or assigned.', paused: 'It is paused, so it takes no new work until you resume it.',
  }[d.status];
  const words = [d.task, d.why.join(' '), wf?.objective, wf?.next_action, appr[0]?.title, appr[0]?.reason, AGENT_EXPLAIN[a.id]].join(' ');
  const terms = termsIn(words);
  return section('In plain English', `<div class="plain">
    <p><b>What this agent is for:</b> ${esc(AGENT_EXPLAIN[a.id] || a.role || '')}</p>
    ${doing ? `<p><b>What it's doing:</b> ${esc(doing)}</p>` : last ? `<p><b>Last thing it did:</b> ${esc(last)}</p>` : ''}
    <p><b>Right now:</b> ${esc(status || '')}${d.needsYou ? ` <b class="gold">You need to: ${esc(d.needsYou)}.</b>` : ''}</p>
    ${wf ? `<p><b>The bigger goal:</b> ${esc(wf.objective)}. It's at the "${esc(F.stageLabel(wf.stage))}" step${wf.next_action ? `; next: ${esc(wf.next_action)}` : ''}.</p>` : ''}
    ${terms.length ? `<details class="x"><summary>Words used here</summary><dl class="facts">${terms.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></details>` : ''}
  </div>`);
}

function contentCard(S, c) {
  const v = (c.versions || []).slice(-1)[0];
  const acct = S.t('brand_accounts').find((x) => x.id === c.account_id);
  const brand = S.t('brands').find((x) => x.id === c.brand_id);
  const checks = c.review?.checks || [];
  return `<div class="card ${c.stage === 'blocked' ? 'err' : ''}"><div class="row between"><b>${esc(c.title || c.topic || 'Untitled')}</b>${chip(F.stageLabel(c.stage || c.status), c.stage === 'blocked' ? 'bad' : c.live_url ? 'ok' : 'ops')}</div>
    <div class="meta">${esc(brand?.name || '')}${acct ? ` → ${esc(acct.platform)} ${esc(acct.handle || '')}` : ''} · ${esc(c.format || c.kind || '')}${c.scheduled_at ? ` · scheduled ${ct(c.scheduled_at)}` : ''}</div>
    ${v?.thumb ? `<img class="thumb" data-path="${esc(v.thumb)}" alt="Thumbnail">` : ''}
    ${v?.video ? `<video class="thumb" controls preload="none" data-video="${esc(v.video)}"></video>` : ''}
    ${(c.versions || []).length ? `<div class="meta">Versions: ${(c.versions || []).map((x) => `v${x.v} by ${esc(x.by)}${x.seconds ? ` (${x.seconds}s)` : ''}`).join(' · ')}</div>` : ''}
    ${c.script?.hook ? `<details class="x"><summary>Script</summary><div class="pre">${esc(JSON.stringify(c.script, null, 2))}</div></details>` : c.body ? `<div class="pre">${esc(c.body)}</div>` : ''}
    ${checks.length ? `<details class="x"><summary>QA: ${checks.filter((x) => x.ok).length}/${checks.length} checks passed</summary><ul class="src">${checks.map((x) => `<li class="${x.ok ? '' : 'down'}">${x.ok ? '✓' : '✕'} ${esc(x.name)}${x.detail ? ` — ${esc(x.detail)}` : ''}</li>`).join('')}</ul></details>` : ''}
    ${c.live_url || c.assets?.live_url ? `<div>Live: <a href="${esc(c.live_url || c.assets.live_url)}" target="_blank" rel="noopener">${esc(c.live_url || c.assets.live_url)}</a></div>` : ''}
  </div>`;
}

// ------------------------------------------------------------------ record viewer (every ticker item / link lands here)
export function recordPanel(S, ui, ctx) {
  const [type, rawId] = String(ui.sub?.ref || '').split(':');
  const id = rawId;
  const find = (t) => S.t(t).find((r) => String(r.id) === String(id));
  const back = '<button class="btn sm ghost" data-act="back">← Back</button>';
  const missing = `<p class="muted">That record isn't loaded (it may be older than what the dashboard keeps in memory).</p>`;
  if (type === 'approval') { const a = find('approvals'); return back + (a ? approvalCard(a, S) : missing); }
  if (type === 'workflow') {
    const w = find('workflows'); if (!w) return back + missing;
    const ap = S.t('approvals').filter((a) => a.workflow_id === w.id);
    const hs = F.handoffs(S).filter((h) => h.workflow === w.id);
    const evs = S.t('workflow_events').filter((e) => e.workflow_id === w.id).sort((x, y) => ms(x.created_at) - ms(y.created_at));
    return [back, workflowCard(S, w), w.owner_agent ? `<div class="row">${refBtn(`agent:${w.owner_agent}`, `Owner desk: ${agentName(S, w.owner_agent)}`, 'btn sm')}${w.subject_type && subjectRef(w.subject_type, w.subject_id) ? refBtn(subjectRef(w.subject_type, w.subject_id), `Open ${w.subject_type}`, 'btn sm') : ''}</div>` : '',
      hs.length ? section('Handoffs', `<ul class="src">${hs.map((h) => `<li>${esc(agentName(S, h.from))} → ${esc(agentName(S, h.to))}: ${esc(h.label)} <span class="faint">${ct(h.at)}</span></li>`).join('')}</ul>`) : '',
      section(`Full audit trail (${evs.length})`, `<div class="timeline">${evs.map((e) => `<div class="ev"><time>${ct(e.created_at)}</time><b>${esc(agentName(S, e.agent_id))}</b> ${chip(e.type)} ${esc(e.message)}</div>`).join('')}</div>`),
      ap.length ? section('Approvals in this workflow', ap.map((a) => approvalCard(a, S)).join('')) : ''].join('');
  }
  if (type === 'task') {
    const t = find('tasks'); if (!t) return back + missing;
    return [back, `<div class="card ${t.status === 'failed' ? 'err' : ''}"><div class="row between"><h4>${esc(F.VERBS[t.kind] || t.kind)}</h4>${statusChip(t.status)}</div>
      <dl class="facts"><dt>Agent</dt><dd>${refBtn(`agent:${t.agent_id}`, agentName(S, t.agent_id))}</dd><dt>Task</dt><dd>#${t.id} (${esc(t.kind)})</dd><dt>Requested by</dt><dd>${esc(t.created_by || '—')}</dd>
      <dt>Created</dt><dd>${ct(t.created_at)}</dd>${t.started_at ? `<dt>Started</dt><dd>${ct(t.started_at)}</dd>` : ''}${t.finished_at ? `<dt>Finished</dt><dd>${ct(t.finished_at)} (${dur(t.started_at, t.finished_at)})</dd>` : ''}
      <dt>Attempts</dt><dd>${t.attempts ?? 0}</dd>${t.error ? `<dt>Error</dt><dd class="down">${esc(t.error)}</dd>` : ''}</dl>
      ${t.input && Object.keys(t.input).length ? `<details class="x"><summary>Input</summary><div class="pre">${esc(JSON.stringify(t.input, null, 2))}</div></details>` : ''}
      ${t.result ? `<details class="x" open><summary>Result</summary><div class="pre">${esc(JSON.stringify(t.result, null, 2))}</div></details>` : ''}
      ${t.status === 'failed' ? `<div class="row"><button class="btn" data-act="retry" data-id="${t.id}">Retry this task</button><span class="meta">Re-runs once. Emails, payments and posts are duplicate-proof.</span></div>` : ''}</div>`].join('');
  }
  if (type === 'event') {
    const e = find('events'); if (!e) return back + missing;
    const near = S.t('workflow_events').filter((w) => w.agent_id === e.agent_id && Math.abs(ms(w.created_at) - ms(e.created_at)) < 3 * 60000);
    return [back, `<div class="card"><div class="row between"><b>${esc(agentName(S, e.agent_id))}</b>${chip(e.level, e.level === 'error' ? 'bad' : e.level === 'warn' ? 'warn' : e.level === 'success' ? 'ok' : '')}</div>
      <p>${esc(e.message)}</p>${e.data?.url ? `<a class="btn sm gold" href="${esc(e.data.url)}" target="_blank" rel="noopener">Open the live link ↗</a>` : ''}<div class="meta">${ct(e.created_at)} · event #${e.id} · ${esc(F.eventKind(e))}</div>
      ${e.data ? `<details class="x"><summary>Data</summary><div class="pre">${esc(JSON.stringify(e.data, null, 2))}</div></details>` : ''}
      <div class="row">${refBtn(`agent:${e.agent_id}`, 'Open desk', 'btn sm')}${near.map((w) => refBtn(`workflow:${w.workflow_id}`, `Workflow #${w.workflow_id}`, 'btn sm')).filter((v, i, a) => a.indexOf(v) === i).join('')}</div></div>`].join('');
  }
  if (type === 'order') {
    const o = find('orders'); if (!o) return back + missing;
    return [back, `<div class="card ${o.status === 'exception' ? 'err' : ''}"><div class="row between"><h4>Order ${esc(o.external_id)}</h4>${statusChip(o.status)}</div>
      <dl class="facts"><dt>Business</dt><dd>${esc(deptName(o.division))}</dd><dt>Amount</dt><dd>${money(o.amount_usd, 2)}</dd><dt>Cost</dt><dd>${o.cost_usd != null ? money(o.cost_usd, 2) : '—'}</dd><dt>Created</dt><dd>${ct(o.created_at)}</dd>
      ${o.data?.next ? `<dt>Next</dt><dd>${esc(o.data.next)}</dd>` : ''}${(o.data?.holds || []).length ? `<dt>Holds</dt><dd class="down">${esc(o.data.holds.join('; '))}</dd>` : ''}</dl>
      ${o.status === 'exception' && o.division === 'dropship' ? `<button class="btn" data-act="ds-release" data-id="${o.id}">Re-check after review</button>` : ''}</div>`].join('');
  }
  if (type === 'content') { const c = find('content_items'); return back + (c ? contentCard(S, c) : missing); }
  if (type === 'ledger') { const r = find('ledger'); return back + (r ? `<div class="card"><dl class="facts"><dt>Amount</dt><dd>${money(r.amount_usd, 2)}</dd><dt>Category</dt><dd>${esc(r.category)}</dd><dt>Basis</dt><dd>${esc(r.basis)}</dd><dt>Business</dt><dd>${esc(r.division)}</dd><dt>Source</dt><dd>${esc(r.source)}</dd><dt>Date</dt><dd>${esc(r.occurred_on)}</dd></dl></div>` : missing); }
  if (type === 'document') { const d = find('documents'); return back + (d ? `<div class="card"><h4>${esc(d.title)}</h4><div class="meta">${ct(d.created_at)}</div>${md(d.body)}</div>` : missing); }
  if (type === 'call') return back + PANELS.agency(S, { sub: { type: 'call', id: Number(id) } });
  if (type === 'prospect') return back + PANELS.agency(S, { sub: { type: 'prospect', id: Number(id) } });
  if (type === 'deal') return back + PANELS.realestate(S, { sub: { type: 'deal', id: Number(id) } });
  if (type === 'deadline') { const d = find('deadlines'); return back + (d ? `<div class="card"><h4>${esc(d.kind.replace(/_/g, ' '))}</h4><div>Due ${ct(d.due_at)} (${ago(d.due_at)})</div>${d.subject_type === 're_deal' ? refBtn(`deal:${d.subject_id}`, `Open deal #${d.subject_id}`, 'btn sm') : ''}</div>` : missing); }
  if (type === 'brand') { const b = find('brands'); return back + (b ? brandCard(S, b) : missing); }
  if (type === 'product') { const p = find('ds_products') || find('products'); return back + (p ? `<div class="card"><h4>${esc(p.title)}</h4><div class="meta">${esc(p.stage || '')}</div><div class="pre">${esc(JSON.stringify(p.economics || {}, null, 2))}</div></div>` : missing); }
  if (type === 'request') { const r = find('work_requests'); if (!r) return back + missing; const t = S.t('tasks').find((x) => x.id === r.task_id);
    return back + requestRow(S, r) + `<div class="card"><dl class="facts"><dt>Brief</dt><dd><div class="pre">${esc(JSON.stringify(r.brief || {}, null, 2))}</div></dd>${t ? `<dt>Task</dt><dd>${refBtn(`task:${t.id}`, `#${t.id} (${t.status})`)}</dd>` : ''}${r.project_id ? `<dt>Project</dt><dd><button class="lnk" data-act="goto" data-id="team">Open projects</button></dd>` : ''}${r.workflow_id ? `<dt>History</dt><dd>${refBtn(`workflow:${r.workflow_id}`, 'Workflow')}</dd>` : ''}</dl></div>`; }
  if (type === 'opportunity') { const o = find('opportunities'); return back + (o ? `<div class="card"><h4>${esc(o.title)}</h4>${md(o.memo || '')}</div>` : missing); }
  return back + missing;
}

// ------------------------------------------------------------------ teamwork: projects (your ideas) and agent-to-agent requests
export const NEED_LABEL = {
  landing_page: ['A landing page / website', 'designer'], social_brand: ['A social media brand', 'brand_dev'], social_content: ['Social media posts', 'social'],
  brand_calendar: ['A content calendar for a brand', 'strategy'], marketing_campaign: ['A marketing campaign plan', 'marketer'], research: ['Market research', 'research'],
  etsy_product: ['Etsy product ideas', 'etsy'], store_product: ['Products for the online store', 'ds_research'], local_leads: ['Local businesses to contact', 'scout'],
  experiment_design: ['A small test with a goal and stop rule', 'experiments'],
};
const reqStatus = { open: ['Waiting to start', 'warn'], queued: ['Queued', 'ops'], in_progress: ['In progress', 'ops'], waiting_approval: ['Needs your approval', 'warn'], done: ['Done', 'ok'], blocked: ['Stopped', 'bad'], rejected: ['Rejected', ''] };
function requestOutput(S, r) {
  const res = r.result || {};
  const site = r.output_ref?.startsWith('site:') ? S.t('sites').find((x) => `site:${x.id}` === r.output_ref) : null;
  if (site) return site.status === 'published' && res.url ? `<a href="${esc(res.url)}" target="_blank" rel="noopener">Live page ↗</a>` : site.status === 'published' ? 'Live' : '<button class="lnk" data-act="goto" data-id="approvals">Draft ready: approve it to publish →</button>';
  if (r.output_ref?.startsWith('document:')) return refBtn(r.output_ref, 'Open report');
  if (res.error) return `<span class="down">${esc(res.error)}</span>`;
  if (res.waiting) return `<span class="gold">${esc(res.waiting)}</span>`;
  return res.summary ? `<span class="meta">${esc(String(res.summary).slice(0, 120))}</span>` : '';
}
export function requestRow(S, r) {
  const [label] = NEED_LABEL[r.need] || [r.need];
  const st = reqStatus[r.status] || [r.status, ''];
  return `<div class="req"><div class="row between"><span>${refBtn(`request:${r.id}`, r.title)}</span>${chip(st[0], st[1])}</div>
    <div class="meta">${esc(r.from_agent === 'owner' ? 'You' : agentName(S, r.from_agent))} → ${r.assigned_agent ? refBtn(`agent:${r.assigned_agent}`, agentName(S, r.assigned_agent)) : 'nobody can do this yet'} · ${esc(label)} · ${ago(r.created_at)}${r.depends_on ? ` · after request #${r.depends_on}` : ''}</div>
    <div>${requestOutput(S, r)}</div></div>`;
}
export function ideaForm() {
  return `<form data-form="give-idea" class="ask"><textarea class="i" id="idea-text" required placeholder="Tell the Big Boss what you want to happen. e.g. “Get catering orders for a taco truck in Bryan: a page people can book from and a few posts to announce it.”" style="min-height:76px"></textarea>
    <div class="row"><button class="btn gold">Give the Big Boss this idea</button><span class="meta">He plans it with the team using only what they can actually do, and shows you the plan first. Nothing public happens without your OK.</span></div></form>`;
}
export function teamPanel(S, ui, ctx) {
  const projects = S.t('team_projects');
  const reqs = S.t('work_requests');
  const loose = reqs.filter((r) => !r.project_id);
  return [
    `<div class="plain">This is how the agents work together. When one agent (or you) needs something another agent makes, like a website, a brand, posts or research, it sends a <b>request</b>. The request goes to the one agent who does that work, and you can follow it here. Public results (a page going live, posts, emails) still wait for your approval.</div>`,
    section('Give the Big Boss an idea', ideaForm()),
    section('Ask the team directly', `<form data-form="ask-team" class="row"><select class="i" id="team-need" style="flex:0 1 260px">${Object.entries(NEED_LABEL).map(([k, [l, ag]]) => `<option value="${k}">${esc(l)} (${esc(agentName(S, ag))})</option>`).join('')}</select>
      <input class="i" id="team-title" placeholder="What exactly? e.g. a page for our $299 website offer" style="flex:1 1 240px"><button class="btn primary">Send</button></form>`),
    section(`Projects (${projects.length})`, projects.length ? projects.map((p) => {
      const steps = reqs.filter((r) => r.project_id === p.id).sort((a, b) => a.id - b.id);
      return `<div class="card ${p.status === 'waiting_approval' ? 'prio' : ''}"><div class="row between"><b>${esc(p.title)}</b>${chip({ planning: 'Planning', waiting_approval: 'Plan needs your OK', active: 'In progress', done: 'Done', cancelled: 'Cancelled' }[p.status] || p.status, p.status === 'done' ? 'ok' : p.status === 'waiting_approval' ? 'warn' : 'ops')}</div>
        <div class="meta">Your idea: “${esc(p.idea.slice(0, 220))}” · ${ago(p.created_at)}</div>
        ${p.plan?.plain_english ? `<div class="plain">${esc(p.plan.plain_english)}</div>` : p.status === 'planning' ? `<div class="muted">The Big Boss is planning this… <span class="elapsed" data-since="${esc(p.created_at)}"></span> (usually 10–20 seconds)</div>` : ''}
        ${p.status === 'waiting_approval' && p.approval_id ? refBtn(`approval:${p.approval_id}`, 'Review and approve the plan →', 'btn sm gold') : ''}
        ${steps.length ? `<div class="reqs">${steps.map((r) => requestRow(S, r)).join('')}</div>` : ''}
        ${(p.plan?.owner_tasks || []).length ? `<div class="note warn"><b>Only you can do:</b> ${esc(p.plan.owner_tasks.join('; '))}</div>` : ''}
        ${p.workflow_id ? refBtn(`workflow:${p.workflow_id}`, 'Full history', 'btn sm ghost') : ''}</div>`;
    }).join('') : '<p class="muted">No projects yet. Give the Big Boss an idea above.</p>'),
    section(`Other team requests (${loose.length})`, loose.length ? `<div class="reqs">${loose.slice(0, 30).map((r) => requestRow(S, r)).join('')}</div>` : '<p class="muted">None yet. Agents create these when they need something from each other (for example, a new brand asks for its link-in-bio page).</p>'),
    section('Pages the team has built', S.t('sites').length ? S.t('sites').map((x) => `<div class="req"><div class="row between"><b>${esc(x.title)}</b>${chip(x.status, x.status === 'published' ? 'ok' : 'warn')}</div>${x.preview_path ? `<img class="thumb" style="max-width:220px" data-path="${esc(x.preview_path)}" alt="Preview of ${esc(x.title)}">` : ''}</div>`).join('') : '<p class="muted">None yet.</p>'),
  ].join('');
}

// ------------------------------------------------------------------ Live Links & Analytics: everything the team put online, with numbers
const PLATFORM = { web: '🌐 Website', youtube: '▶ YouTube', instagram: '◎ Instagram', tiktok: '♪ TikTok', facebook: 'f Facebook', x: '𝕏 X', etsy: 'Etsy', shopify: 'Shopify store', other: 'Link' };
const KIND = { page: 'Web page', video: 'Video', post: 'Post', listing: 'Product listing', store_product: 'Store product', account: 'Account / page' };
const fmt = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('en-US'));
function spark(daily) {
  if (!daily?.length) return '';
  const max = Math.max(1, ...daily.map((d) => d[1]));
  const w = 140, h = 28, bw = w / daily.length;
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Views per day, last 14 days">${daily.map(([day, v], i) => `<rect x="${i * bw + 1}" y="${h - (v / max) * (h - 2)}" width="${bw - 2}" height="${(v / max) * (h - 2)}" fill="#7be0a8"><title>${day}: ${v} views</title></rect>`).join('')}</svg>`;
}
function linkMetrics(l) {
  const m = l.metrics || {};
  const cells = [];
  if (l.kind === 'page') cells.push(['Views (7d)', m.views_7d], ['Visitors (7d)', m.visitors_7d], ['Clicks (7d)', m.clicks_7d], ['Views (all time)', m.views_total]);
  else if (l.kind === 'video') cells.push(['Views', m.views], ['Likes', m.likes], ['Comments', m.comments], ['Views gained (7d)', m.views_7d_change]);
  else if (l.kind === 'account') cells.push(['Followers', m.followers], ['Total views', m.views], ...(m.videos != null ? [['Videos', m.videos]] : []), ...(m.likes != null ? [['Likes', m.likes]] : []));
  else if (l.kind === 'listing' || l.kind === 'store_product') cells.push(['Views', m.views], ['Favorites', m.favorites], ['Orders', m.orders], ['Revenue', m.revenue_usd != null ? M.money(m.revenue_usd, 2) : null]);
  else cells.push(['Views', m.views], ['Likes', m.likes], ['Clicks', m.clicks], ['Followers', m.followers]);
  const shown = cells.filter(([, v]) => v != null);
  return `<div class="lm">${shown.length ? shown.map(([k, v]) => `<div><b>${typeof v === 'string' ? esc(v) : fmt(v)}</b><span>${esc(k)}</span></div>`).join('') : '<span class="muted">No numbers yet.</span>'}${l.kind === 'page' ? spark(m.daily) : ''}</div>
    <div class="meta">${m.error ? `<span class="down">Couldn't refresh: ${esc(m.error)}</span> · ` : ''}${m.source ? `Source: ${esc(m.source)}` : ''}${l.metrics_updated_at ? ` · updated ${ago(l.metrics_updated_at)}` : ''}${m.top_referrers?.length ? ` · from: ${m.top_referrers.map(([h, c]) => `${esc(h)} (${c})`).join(', ')}` : ''}</div>`;
}
export function linksPanel(S, ui, ctx) {
  const all = S.t('published_links');
  const live = all.filter((l) => l.status === 'live');
  const f = ui.filter || '';
  const shown = all.filter((l) => !f || (f === 'removed' ? l.status === 'removed' : l.kind === f && l.status === 'live'));
  const sumM = (k, rows) => rows.reduce((s, l) => s + Number(l.metrics?.[k] || 0), 0);
  const pages = live.filter((l) => l.kind === 'page');
  const brands = Object.fromEntries(S.t('brands').map((b) => [b.id, b.name]));
  const groups = {};
  for (const l of shown) (groups[l.brand_id ? `Brand: ${brands[l.brand_id] || l.brand_id}` : l.project_id ? `Project: ${S.t('team_projects').find((p) => p.id === l.project_id)?.title || l.project_id}` : 'KJ Agentic'] ||= []).push(l);
  return [
    `<div class="plain">Everything the team has put online, with a link to open it and where it lives. Numbers come straight from the source: our own visit counter for pages we host, YouTube for videos and channels, Etsy and Shopify for listings and sales. For accounts we can't read automatically (for example Instagram or TikTok without a connection), you type in the numbers and it keeps the history.</div>`,
    `<div class="kpis">${kpi('Live links', live.length)}${kpi('Page views (7d)', fmt(sumM('views_7d', pages)), 'actual')}${kpi('Page clicks (7d)', fmt(sumM('clicks_7d', pages)), 'actual')}${kpi('Video views', fmt(sumM('views', live.filter((l) => l.kind === 'video'))), 'actual')}${kpi('Followers', fmt(sumM('followers', live.filter((l) => l.kind === 'account'))), 'actual')}${kpi('Orders from listings', fmt(sumM('orders', live.filter((l) => ['listing', 'store_product'].includes(l.kind)))), 'actual')}</div>`,
    `<div class="row"><button class="btn primary sm" data-act="refresh-links">Refresh numbers now</button>${['', 'page', 'video', 'post', 'account', 'listing', 'store_product', 'removed'].map((k) => `<button class="btn sm ${f === k ? 'primary' : ''}" data-act="filter" data-id="${k}">${k ? (k === 'removed' ? 'Taken down' : KIND[k]) : 'All'}</button>`).join('')}</div>`,
    ...Object.entries(groups).map(([g, rows]) => section(`${g} (${rows.length})`, rows.map((l) => `<div class="card linkcard ${l.status === 'removed' ? 'faint' : ''}">
      <div class="row between"><div><b>${esc(l.title)}</b><div class="meta">${esc(PLATFORM[l.platform] || l.platform)} · ${esc(KIND[l.kind] || l.kind)} · lives at: ${esc(l.where_it_lives || l.platform)} · live since ${ct(l.created_at)}${l.created_by ? ` · by ${esc(l.created_by === 'owner' ? 'you' : agentName(S, l.created_by))}` : ''}</div></div>
        <a class="btn sm gold" href="${esc(l.url)}" target="_blank" rel="noopener">Open ↗</a></div>
      <div class="meta url">${esc(l.url)}</div>
      ${linkMetrics(l)}
      ${l.analytics === 'manual' ? `<details class="x"><summary>Update its numbers (from the app's insights)</summary><form data-form="link-metrics" data-id="${l.id}" class="grid2">${['followers', 'views', 'likes', 'clicks'].map((k) => `<label class="f">${k}<input class="i" type="number" min="0" id="lm-${k}-${l.id}" value="${l.metrics?.[k] ?? ''}"></label>`).join('')}<button class="btn sm primary">Save</button></form>${(l.metrics?.history || []).length > 1 ? `<div class="meta">History: ${l.metrics.history.slice(-6).map((h) => `${h.on}: ${fmt(h.views)} views / ${fmt(h.followers)} followers`).join(' · ')}</div>` : ''}</details>` : ''}
      <div class="row">${l.status === 'live' ? `<button class="btn sm ghost" data-act="link-status" data-id="${l.id}" data-status="removed">Mark as taken down</button>` : `<button class="btn sm ghost" data-act="link-status" data-id="${l.id}" data-status="live">Mark live again</button>`}</div>
    </div>`).join(''))),
    shown.length ? '' : '<p class="muted">Nothing here yet. When the team publishes a page, video, listing or account, it appears here automatically with its link and numbers.</p>',
    section('Add something you posted yourself', `<form data-form="add-link" class="grid2">
      <label class="f">Link<input class="i" id="al-url" type="url" required placeholder="https://www.instagram.com/p/…"></label>
      <label class="f">What is it?<input class="i" id="al-title" placeholder="e.g. Launch post for taco catering"></label>
      <label class="f">Type<select class="i" id="al-kind">${Object.entries(KIND).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="f">Platform<select class="i" id="al-platform">${Object.entries(PLATFORM).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="f">Where it lives (account)<input class="i" id="al-where" placeholder="@deskfixdaily on Instagram"></label>
      <div class="row" style="align-items:end"><button class="btn primary">Add link</button></div></form>`),
  ].join('');
}

// ------------------------------------------------------------------ Executive Office: Big Boss briefing + Talk to the Big Boss
export function execPanel(S, ui, ctx) {
  const B = F.briefing(S, ctx.lastVisit);
  const boss = ctx.desks.manager;
  const asks = S.t('commands').filter((c) => c.kind === 'ask_boss').slice(0, 5);
  const p = B.money;
  const list = (items, empty) => (items.length ? `<ul class="src">${items.slice(0, 8).map((x) => `<li>${refBtn(x.ref, x.text)}${x.at ? ` <span class="faint">${ago(x.at)}</span>` : ''}</li>`).join('')}${items.length > 8 ? `<li class="faint">+${items.length - 8} more</li>` : ''}</ul>` : `<p class="muted">${empty}</p>`);
  return [
    `<div class="card hero boss" style="--c:#f2c14e"><div class="row between"><div><b class="gold">Big Boss Manager</b><div class="meta">The Executive Orchestrator (agent "manager"). Sets priorities and assigns work. It cannot override approvals, budgets or permissions.</div></div>${boss ? statusTag(boss.status) : ''}</div>
      ${boss ? `<div class="meta">${esc(boss.task || boss.why[0] || '')}</div>` : ''}
      <div class="row"><button class="btn sm" data-act="desk" data-id="manager">Inspect the Big Boss</button><button class="btn sm" data-act="goto" data-id="monitor">All Agents monitor</button><button class="btn sm" data-act="goto" data-id="timeline">Today's timeline</button>
      <button class="btn sm" data-act="run" data-agent="manager" data-kind="plan" data-input="{}">Review all divisions now</button></div></div>`,
    section('Give the Big Boss an idea', ideaForm() + (() => { const act = S.t('team_projects').filter((p) => p.status !== 'done' && p.status !== 'cancelled'); return act.length ? `<div class="meta">${act.length} project(s) in progress. <button class="lnk" data-act="goto" data-id="team">See projects & team requests →</button></div>` : ''; })()),
    section('Talk to the Big Boss', `<form data-form="ask-boss" class="ask"><textarea class="i" id="boss-q" placeholder="e.g. What's blocking revenue this week? What needs me first?" required style="min-height:64px"></textarea><div class="row"><button class="btn primary">Ask</button><span class="meta">${S.demo ? 'Demo: answered from sample data in your browser.' : 'Answers come only from your records (small AI cost). Suggested actions run through the normal approvals.'}</span></div></form>
      ${asks.map((c) => `<div class="card"><div class="meta">You asked ${ago(c.created_at)}: “${esc(c.input?.question || '')}”</div>
        ${c.status === 'queued' || c.status === 'running' ? `<div class="muted">Thinking… <span class="elapsed" data-since="${esc(c.created_at)}"></span> (usually 5–15 seconds)</div>` : c.status === 'failed' ? `<div class="down">${esc(c.result?.error || 'Failed')}</div>`
          : `<div>${esc(c.result?.answer || '')}</div>${(c.result?.refs || []).length ? `<div class="row">${c.result.refs.map((r) => refBtn(r, r, 'btn sm ghost')).join('')}</div>` : ''}
          ${(c.result?.actions || []).length ? `<div class="row">${c.result.actions.map((a, i) => `<button class="btn sm gold" data-act="boss-action" data-cmd="${c.id}" data-i="${i}">${esc(a.label || a.type)}</button>`).join('')}<span class="meta">Proposed. Nothing happens until you click.</span></div>` : ''}`}</div>`).join('')}`),
    section('Right now', `${B.now.working.length ? list(B.now.working, '') : '<p class="muted">No agent is running a task right now.</p>'}`),
    section(`Since your last visit (${ago(B.since.since)})`, `<div class="kpis">${kpi('Tasks done', B.since.counts.tasksDone)}${kpi('Approvals executed', B.since.counts.executed)}${kpi('Collected', money(B.since.counts.collected), 'actual')}${kpi('Failures', B.since.counts.failures)}${kpi('Handoffs', B.since.counts.handoffs)}</div>${list(B.since.highlights, 'Nothing notable since your last visit.')}`),
    section('Revenue & cost (7 days)', `<div class="kpis">${kpi(p.collected.label, money(p.collected.v), 'actual')}${kpi(p.contribution.label, money(p.contribution.v), 'estimated')}${kpi(p.costs.label, money(p.costs.v), 'estimated')}${kpi(p.pipeline.label, money(p.pipeline.v), 'forecast')}</div>`),
    section(`Blocked or stalled (${B.blocked.length})`, list(B.blocked, 'Nothing blocked or stalled.')),
    section(`Needs your approval (${B.approvals.length})`, list(B.approvals, 'Nothing waiting for you.') + (B.approvals.length ? '<button class="btn gold sm" data-act="goto" data-id="approvals">Open approvals</button>' : '')),
    section('Plan on record', B.plan ? `<details class="card" open><summary class="row between" style="cursor:pointer"><b>${esc(B.plan.title)}</b><span class="meta">${ago(B.plan.at)}</span></summary>${md(B.plan.body)}</details>` : '<p class="muted">The Big Boss hasn\'t written a plan yet.</p>'),
    PANELS.overview(S),
  ].join('');
}

// ------------------------------------------------------------------ All Agents live monitor
export function monitorPanel(S, ui, ctx) {
  const f = ui.mon || {};
  let rows = Object.values(ctx.desks);
  if (f.q) { const q = f.q.toLowerCase(); rows = rows.filter((d) => `${d.name} ${d.role} ${d.task || ''} ${deptName(d.dept)}`.toLowerCase().includes(q)); }
  if (f.dept) rows = rows.filter((d) => d.dept === f.dept);
  if (f.status) rows = rows.filter((d) => d.status === f.status);
  if (f.needs) rows = rows.filter((d) => d.needsYou);
  const sorters = { status: (a, b) => F.STATUS_ORDER.indexOf(a.status) - F.STATUS_ORDER.indexOf(b.status), name: (a, b) => a.name.localeCompare(b.name), dept: (a, b) => a.dept.localeCompare(b.dept), time: (a, b) => ms(a.since || 0) - ms(b.since || 0) };
  rows.sort(sorters[f.sort || 'status'] || sorters.status);
  const counts = Object.fromEntries(Object.keys(F.STATUS).map((k) => [k, Object.values(ctx.desks).filter((d) => d.status === k).length]));
  return [
    `<div class="row">${Object.values(F.STATUS).map((s) => `<button class="stag btnlike ${f.status === s.key ? 'on' : ''}" style="--c:${s.color}" data-act="mon" data-k="status" data-v="${f.status === s.key ? '' : s.key}">${s.icon} ${esc(s.label)} ${counts[s.key]}</button>`).join('')}</div>`,
    `<div class="row"><input class="i" style="flex:1;min-width:160px" id="mon-q" placeholder="Search agents, tasks…" value="${esc(f.q || '')}" data-mon="q">
      <select class="i" style="width:auto" data-mon="dept"><option value="">All departments</option>${F.DEPTS.map((d) => `<option value="${d.id}" ${f.dept === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>
      <select class="i" style="width:auto" data-mon="sort">${[['status', 'Sort: status'], ['name', 'Sort: name'], ['dept', 'Sort: department'], ['time', 'Sort: time on task']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <label class="meta"><input type="checkbox" data-mon="needs" ${f.needs ? 'checked' : ''}> Needs me</label></div>`,
    table([
      { label: 'Agent', html: (d) => `<b>${esc(d.name)}</b><div class="faint">${esc(deptName(d.dept))}</div>` },
      { label: 'Status', html: (d) => statusTag(d.status) + (d.needsYou ? `<div class="gold" style="font-size:11px" title="${esc(d.needsYou)}">needs you</div>` : '') },
      { label: 'Task · next', html: (d) => `<span title="${esc(d.why.join(' · '))}">${esc(d.task || '—')}</span>${d.next ? `<div class="faint">Next: ${esc(d.next)}</div>` : ''}<div class="faint">${d.since && d.status === 'working' ? `for ${dur(d.since)}` : d.since ? ago(d.since) : ''}</div>` },
      { label: '', html: (d) => `<div class="row" style="flex-direction:column;align-items:stretch;gap:4px"><button class="btn sm" data-act="watch" data-id="${d.id}">Watch Work</button><button class="btn sm ghost" data-act="desk" data-id="${d.id}">Inspect</button></div>` },
    ], rows, { empty: 'No agents match.' }),
    `<p class="faint" style="font-size:11px">Status comes from the task queue, approvals, workflows and pause switches. Nothing is shown as working unless a task is actually running.</p>`,
  ].join('');
}

// ------------------------------------------------------------------ view modes
export function moneyPanel(S, ui, ctx) {
  const W = ctx.walls.performance;
  const rows = Object.entries(W.byBusiness).sort((a, b) => b[1].collected - a[1].collected);
  return [
    `<div class="kpis">${kpi(W.collected.label, money(W.collected.v), 'actual', M.DEFINITIONS.collected)}${kpi(W.contribution.label, money(W.contribution.v), 'estimated', M.DEFINITIONS.contribution)}${kpi(W.costs.label, money(W.costs.v), 'estimated')}${kpi(W.commitments.label, money(W.commitments.v), 'forecast', M.DEFINITIONS.commitments)}${kpi(W.pipeline.label, money(W.pipeline.v), 'forecast', M.DEFINITIONS.pipeline)}</div>`,
    section('Cost breakdown (7 days)', `<div class="kpis">${Object.entries(W.costs.parts).map(([k, v]) => kpi(k.replace(/^ai$/, 'AI (estimate)'), money(v, 2), k === 'ai' ? 'estimated' : 'actual')).join('')}</div>`),
    section('By business (7 days)', rows.length ? table([{ label: 'Business', get: ([k]) => deptName(k) }, { label: 'Collected', num: true, html: ([, v]) => `<span class="up">${money(v.collected)}</span>` }, { label: 'Costs', num: true, get: ([, v]) => money(v.costs) }, { label: 'Margin', num: true, html: ([, v]) => (v.collected ? `<span class="${v.collected - v.costs < 0 ? 'down' : 'up'}">${M.pct((v.collected - v.costs) / v.collected)}</span>` : '—') }], rows) : '<p class="muted">No money recorded in the last 7 days.</p>'),
    PANELS.finance(S),
  ].join('');
}

export function workflowPanel(S, ui, ctx) {
  const open = S.t('workflows').filter((w) => ['active', 'waiting_approval', 'blocked', 'paused'].includes(w.status));
  const filter = ui.filter;
  const list = filter === 'blocked' || filter === 'blocked-orders' ? open.filter((w) => w.status === 'blocked') : open;
  const hs = F.handoffs(S).slice(0, 15);
  const deps = F.dependencies(ctx.desks);
  const stalls = F.stalls(S);
  const byDiv = {};
  for (const w of list) (byDiv[w.division] ||= []).push(w);
  const blockedOrders = filter === 'blocked-orders' ? S.t('orders').filter((o) => o.status === 'exception') : [];
  return [
    `<div class="row"><button class="btn sm ${!filter ? 'primary' : ''}" data-act="filter" data-id="">All open (${open.length})</button><button class="btn sm ${filter === 'blocked' ? 'primary' : ''}" data-act="filter" data-id="blocked">Blocked (${open.filter((w) => w.status === 'blocked').length})</button></div>`,
    blockedOrders.length ? section('Blocked orders', blockedOrders.map((o) => `<div class="card err">${refBtn(`order:${o.id}`, `Order ${o.external_id}`)} <span class="meta">${esc((o.data?.holds || []).join('; '))}</span></div>`).join('')) : '',
    stalls.length ? section(`Stalled (${stalls.length})`, `<ul class="src">${stalls.map((s) => `<li>${refBtn(s.ref, s.what)} <span class="faint">— ${esc(s.rule)}</span></li>`).join('')}</ul>`) : '',
    ...Object.entries(byDiv).map(([div, ws]) => section(`${deptName(div)} (${ws.length})`, ws.slice(0, 25).map((w) => {
      const plan = F.STAGE_PLAN[w.kind]; const i = plan ? plan.indexOf(w.stage) : -1;
      return `<div class="card ${w.status === 'blocked' ? 'err' : w.status === 'waiting_approval' ? 'prio' : ''}"><div class="row between">${refBtn(`workflow:${w.id}`, w.objective)}${statusChip(w.status)}</div>
        ${plan ? `<div class="stages">${plan.map((s, k) => `<span class="sg ${k < i ? 'done' : k === i ? 'cur' : ''}">${esc(F.stageLabel(s))}</span>`).join('')}</div>` : `<div class="meta">Stage: ${esc(F.stageLabel(w.stage))}</div>`}
        <div class="meta">Owner: ${refBtn(`agent:${w.owner_agent}`, agentName(S, w.owner_agent))} · next: ${esc(w.next_action || '—')}${w.next_action_at ? ` · due ${ct(w.next_action_at)} (scheduled time on record)` : ''} · updated ${ago(w.updated_at)}</div>
        ${w.blockers ? `<div class="down">${esc(w.blockers)}</div>` : ''}</div>`;
    }).join(''))),
    section('Who is waiting on whom', deps.length ? table([{ label: 'Agent', html: (x) => refBtn(`agent:${x.agent}`, agentName(S, x.agent)) }, { label: 'Waiting on', html: (x) => (x.kind === 'agent' ? refBtn(`agent:${x.on}`, agentName(S, x.on)) : `<span class="${x.kind === 'owner' ? 'gold' : ''}">${esc(x.on)}</span>`) }, { label: 'For', html: (x) => (x.ref ? refBtn(x.ref, x.reason || x.ref) : esc(x.reason || '')) }], deps) : '<p class="muted">No dependencies right now.</p>'),
    section('Recent handoffs', hs.length ? `<ul class="src">${hs.map((h) => `<li>${refBtn(h.ref, `${agentName(S, h.from)} → ${agentName(S, h.to)}: ${h.label}`)} <span class="faint">${ago(h.at)}</span></li>`).join('')}</ul>` : '<p class="muted">No handoffs recorded yet.</p>'),
    '<p class="faint" style="font-size:11px">Progress shows the stage actually reached. No percentages or ETAs are invented; a due time appears only when the workflow has a scheduled next step.</p>',
  ].join('');
}

export function customerPanel(S, ui, ctx) {
  const f = ui.filter || '';
  const calls = S.t('call_tasks').filter((c) => ['ready', 'scheduled', 'calling'].includes(c.status));
  const orders = S.t('orders').filter((o) => !['delivered', 'cancelled'].includes(o.status)).slice(0, 40);
  const convs = S.t('conversations').filter((c) => !['resolved', 'closed'].includes(c.status));
  const deals = S.t('re_deals').filter((d) => ['contacted', 'conversation', 'meeting', 'offer_review', 'offer_sent', 'under_contract', 'due_diligence'].includes(d.stage));
  const tabs = [['', 'Everything'], ['calls', `Calls (${calls.length})`], ['orders', `Orders (${orders.length})`], ['support', `Conversations (${convs.length})`], ['deals', `Sellers (${deals.length})`]];
  return [
    `<div class="row">${tabs.map(([k, l]) => `<button class="btn sm ${f === k ? 'primary' : ''}" data-act="filter" data-id="${k}">${l}</button>`).join('')}</div>`,
    !f || f === 'calls' ? section("Today's calls", calls.length ? table([{ label: 'Business', html: (c) => refBtn(`call:${c.id}`, F.subjectName(S, 'prospect', c.prospect_id) || c.phone || 'Call') }, { label: 'Phone', get: (c) => c.phone || '—' }, { label: 'Goal', get: (c) => c.objective || '' }, { label: 'Mode', html: (c) => (c.mode === 'ai' ? chip('AI (consented)', 'ops') : chip('You call', 'warn')) }], calls) : '<p class="muted">No calls waiting.</p>', 'AI calls only with written consent') : '',
    !f || f === 'orders' ? section('Orders', orders.length ? table([{ label: 'Order', html: (o) => refBtn(`order:${o.id}`, o.external_id) }, { label: 'Business', get: (o) => deptName(o.division) }, { label: 'Status', html: (o) => statusChip(o.status) }, { label: 'Amount', num: true, get: (o) => money(o.amount_usd, 2) }, { label: 'Age', get: (o) => ago(o.created_at) }], orders) : '<p class="muted">No open orders.</p>') : '',
    !f || f === 'support' ? section('Conversations', convs.length ? table([{ label: 'Subject', html: (c) => `<button class="lnk" data-act="goto-conv" data-id="${c.id}">${esc(c.subject || 'Conversation')}</button>` }, { label: 'Status', html: (c) => statusChip(c.status) }, { label: 'Summary', get: (c) => c.summary || '' }, { label: 'Last', get: (c) => ago(c.last_message_at) }], convs) : '<p class="muted">No open conversations.</p>') : '',
    !f || f === 'deals' ? section('Seller conversations', deals.length ? table([{ label: 'Property', html: (d) => refBtn(`deal:${d.id}`, F.subjectName(S, 're_deal', d.id) || `Deal #${d.id}`) }, { label: 'Stage', get: (d) => F.stageLabel(d.stage) }, { label: 'Updated', get: (d) => ago(d.updated_at) }], deals) : '<p class="muted">No active seller conversations.</p>') : '',
  ].join('');
}

function brandCard(S, b) {
  const accts = S.t('brand_accounts').filter((a) => a.brand_id === b.id);
  return `<div class="card"><div class="row between"><b>${esc(b.name)}</b>${statusChip(b.status)}</div><div class="meta">${esc(b.niche || '')}${b.business_division ? ` · supports ${esc(deptName(b.business_division))}` : ''}${b.ceo_agent_id ? ` · CEO: ${esc(agentName(S, b.ceo_agent_id))}` : ''}</div>
    ${b.name_check?.note ? `<div class="note">${esc(b.name_check.note)}</div>` : ''}
    ${accts.length ? accts.map((a) => `<div class="card"><div class="row between"><b>${esc(a.platform)} ${esc(a.handle || '')}</b>${statusChip(a.status)}</div>
      ${a.profile_url ? `<a href="${esc(a.profile_url)}" target="_blank" rel="noopener">${esc(a.profile_url)}</a>` : ''}
      ${(a.owner_tasks || []).length ? `<div class="meta">Your setup steps:</div><ul class="checks">${a.owner_tasks.map((t, i) => `<li><label><input type="checkbox" data-act="acct-task" data-id="${a.id}" data-i="${i}" ${t.done ? 'checked' : ''}> ${esc(t.task)}</label></li>`).join('')}</ul>` : ''}
      <div class="row">${a.platform === 'youtube' && a.status !== 'connected' ? `<button class="btn sm primary" data-act="yt-connect" data-id="${a.id}">Connect YouTube</button>` : ''}
      ${a.platform !== 'youtube' && a.status !== 'connected' ? `<button class="btn sm" data-act="acct-manual" data-id="${a.id}">I created it: record profile link</button>` : ''}</div>
      ${(() => { const c = S.t('commands').find((x) => x.kind === 'youtube_connect' && x.input?.account_id === a.id); return c?.result?.url ? `<div class="note">Open this link to sign in to the brand's channel (single use): <a href="${esc(c.result.url)}" target="_blank" rel="noopener">Connect</a></div>` : c && c.status !== 'done' ? '<div class="meta">Preparing the sign-in link…</div>' : ''; })()}
    </div>`).join('') : '<p class="muted">No accounts planned yet.</p>'}
  </div>`;
}

export function contentPanel(S, ui, ctx) {
  const brands = S.t('brands');
  const items = S.t('content_items').filter((c) => c.brand_id || c.division === 'media' || c.division === 'sports');
  const stages = ['idea', 'creation', 'editing', 'review', 'scheduled', 'published', 'measured', 'blocked'];
  const f = ui.filter || '';
  const shown = items.filter((c) => !f || (c.stage || c.status) === f).sort((a, b) => ms(a.scheduled_at || a.created_at) - ms(b.scheduled_at || b.created_at));
  const upcoming = items.filter((c) => c.scheduled_at && ms(c.scheduled_at) > Date.now()).sort((a, b) => ms(a.scheduled_at) - ms(b.scheduled_at)).slice(0, 10);
  const W = ctx.walls.content;
  return [
    deptStrip(S, ctx, 'media'),
    `<div class="kpis">${kpi(W.inProduction.label, W.inProduction.v)}${kpi(W.awaitingApproval.label, W.awaitingApproval.v)}${kpi(W.upcoming.label, W.upcoming.v)}${kpi(W.published.label, W.published.v)}${kpi(W.views.label, W.views.v ?? '—', W.views.basis)}${kpi(W.attributed.label, '—', 'na')}</div>`,
    `<div class="row"><button class="btn primary" data-act="new-brand">Propose a brand</button><span class="meta">Brands start only from your request; accounts are created by you.</span></div>`,
    section(`Brands (${brands.length})`, brands.length ? brands.map((b) => brandCard(S, b)).join('') : '<p class="muted">No brands yet.</p>'),
    section('Calendar (next scheduled)', upcoming.length ? table([{ label: 'When', get: (c) => ct(c.scheduled_at) }, { label: 'Item', html: (c) => refBtn(`content:${c.id}`, c.title || c.topic || 'Item') }, { label: 'Stage', get: (c) => F.stageLabel(c.stage || c.status) }, { label: 'Destination', get: (c) => { const a = S.t('brand_accounts').find((x) => x.id === c.account_id); return a ? `${a.platform} ${a.handle || ''}` : c.channel || '—'; } }], upcoming) : '<p class="muted">Nothing scheduled.</p>'),
    section('Production pipeline', `<div class="row">${['', ...stages].map((s) => `<button class="btn sm ${f === s ? 'primary' : ''}" data-act="filter" data-id="${s}">${s ? `${F.stageLabel(s)} (${items.filter((c) => (c.stage || c.status) === s).length})` : 'All'}</button>`).join('')}</div>${shown.slice(0, 20).map((c) => contentCard(S, c)).join('') || '<p class="muted">No content items.</p>'}`),
  ].join('');
}

export function healthPanel(S, ui, ctx) {
  const tasks = S.t('tasks');
  const q = tasks.filter((t) => ['queued', 'running'].includes(t.status));
  const fails = tasks.filter((t) => t.status === 'failed' && ms(t.finished_at || t.created_at) > Date.now() - 864e5);
  const byAgent = {};
  for (const t of q) (byAgent[t.agent_id] ||= { queued: 0, running: 0 })[t.status]++;
  const fresh = [['Agents (heartbeat)', S.t('agents').find((a) => a.id === 'manager')?.last_seen], ['Events', S.t('events')[0]?.created_at], ['Tasks', tasks.map((t) => t.finished_at || t.started_at || t.created_at).sort().pop()],
    ['Workflows', S.t('workflows').map((w) => w.updated_at).sort().pop()], ['Ledger', S.t('ledger').map((r) => r.created_at).sort().pop()], ['Integrations checked', S.t('integrations').map((i) => i.checked_at).sort().pop()]];
  const c = ctx.conn || {};
  return [
    section('Live connection', `<dl class="facts"><dt>Data</dt><dd>${S.demo ? '<span class="gold">Demonstration data (isolated, nothing real)</span>' : 'Your live Supabase project'}</dd><dt>Live updates</dt><dd>${esc(c.label || '—')}</dd><dt>Last update received</dt><dd>${c.last ? `${ago(new Date(c.last).toISOString())}` : '—'}</dd><dt>Worker</dt><dd>${M.online(S) ? '<span class="up">online</span>' : '<span class="down">no heartbeat in 4+ minutes</span>'}</dd></dl>`),
    section('Data freshness', table([{ label: 'Source', get: (r) => r[0] }, { label: 'Latest', html: (r) => (r[1] ? `${ago(r[1])} <span class="faint">${ct(r[1])}</span>` : '<span class="faint">none</span>') }], fresh)),
    section(`Job queue (${q.length})`, Object.keys(byAgent).length ? table([{ label: 'Agent', html: ([id]) => refBtn(`agent:${id}`, agentName(S, id)) }, { label: 'Running', num: true, get: ([, v]) => v.running }, { label: 'Queued', num: true, get: ([, v]) => v.queued }], Object.entries(byAgent)) : '<p class="muted">Queue is empty.</p>'),
    section(`Failures, last 24h (${fails.length})`, fails.length ? table([{ label: 'Task', html: (t) => refBtn(`task:${t.id}`, `${F.VERBS[t.kind] || t.kind} (#${t.id})`) }, { label: 'Agent', get: (t) => agentName(S, t.agent_id) }, { label: 'Error', html: (t) => `<span class="down">${esc((t.error || '').slice(0, 140))}</span>` }, { label: '', html: (t) => `<button class="btn sm" data-act="retry" data-id="${t.id}">Retry</button>` }], fails) : '<p class="muted">No failures.</p>'),
    section('Integrations', `<div class="row"><button class="btn sm" data-act="check-integrations">Re-check now</button></div>${integrationList(S)}`),
    section('Stalls', (() => { const s = F.stalls(S); return s.length ? `<ul class="src">${s.map((x) => `<li>${refBtn(x.ref, x.what)} <span class="faint">${esc(x.rule)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing stalled.</p>'; })()),
  ].join('');
}

// ------------------------------------------------------------------ expanded display walls
export function wallPanel(S, ui, ctx) {
  const id = ui.sub?.wall || 'performance';
  if (id === 'performance') return moneyPanel(S, ui, ctx);
  if (id === 'content') return contentPanel(S, ui, ctx);
  if (id === 'commerce') return customerPanel(S, { ...ui, filter: ui.filter ?? 'orders' }, ctx) + section('Commerce stations', `<div class="row"><button class="btn sm" data-act="goto" data-id="dropship">Dropshipping</button><button class="btn sm" data-act="goto" data-id="etsy">Etsy</button></div>`);
  if (id === 'sales') {
    const W = ctx.walls.sales;
    return `<div class="kpis">${Object.values(W).map((x) => kpi(x.label, x.v, 'actual')).join('')}</div>${PANELS.agency(S, { ...ui, sub: null })}`;
  }
  const A = ctx.walls.attention;
  const ints = S.t('integrations').filter((i) => i.status === 'error');
  const esc8 = S.t('conversations').filter((c) => c.status === 'escalated' || c.urgent);
  const dl = S.t('deadlines').filter((d) => d.status === 'open' && ms(d.due_at) - Date.now() < 7 * 864e5);
  return [
    `<div class="kpis">${Object.values(A).map((x) => kpi(x.label, x.v, 'actual')).join('')}</div>`,
    section('Approvals', `<button class="btn gold" data-act="goto" data-id="approvals">${A.approvals.v} waiting</button>`),
    ints.length ? section('Failed integrations', integrationList(S, ints.map((i) => i.id))) : '',
    A.budget.v ? section('Budget limits', `<p>AI budget or a standing-approval budget is at its limit. ${refBtn('wall:performance', 'See costs')}</p>`) : '',
    esc8.length ? section('Customer escalations', esc8.map((c) => `<div class="card">${esc(c.subject || '')}</div>`).join('')) : '',
    dl.length ? section('Real estate deadlines (7 days)', `<ul class="src">${dl.map((d) => `<li>${refBtn(`deadline:${d.id}`, `${d.kind.replace(/_/g, ' ')} · ${ct(d.due_at)}`)}</li>`).join('')}</ul>`) : '',
    section('Stalled workflows', (() => { const s = F.stalls(S); return s.length ? `<ul class="src">${s.map((x) => `<li>${refBtn(x.ref, x.what)} <span class="faint">${esc(x.rule)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing stalled.</p>'; })()),
  ].join('');
}

export function timelinePanel(S, ui, ctx) {
  const items = F.timeline(S);
  return items.length ? `<div class="timeline">${items.map((x) => `<div class="ev"><time>${ct(x.at, { month: undefined, day: undefined })}</time>${refBtn(x.ref, x.text, `lnk ${x.level === 'error' ? 'down' : x.level === 'warn' ? 'gold' : ''}`)} <span class="faint">${esc(agentName(S, x.agent))}</span></div>`).join('')}</div>` : '<p class="muted">Nothing recorded yet today (Central time).</p>';
}

export function sincePanel(S, ui, ctx) {
  const X = F.sinceLastVisit(S, ctx.lastVisit);
  return [
    `<p class="meta">Since ${ct(X.since)} (${ago(X.since)})</p>`,
    `<div class="kpis">${kpi('Recorded events', X.counts.events)}${kpi('Tasks done', X.counts.tasksDone)}${kpi('Failures', X.counts.failures)}${kpi('New approvals', X.counts.newApprovals)}${kpi('Executed', X.counts.executed)}${kpi('Collected', money(X.counts.collected), 'actual')}${kpi('Published', X.counts.published)}${kpi('New orders', X.counts.orders)}</div>`,
    X.highlights.length ? `<ul class="src">${X.highlights.map((h) => `<li class="${h.tone}">${refBtn(h.ref, h.text)} <span class="faint">${ago(h.at)}</span></li>`).join('')}</ul>` : '<p class="muted">Nothing notable.</p>',
    '<button class="btn sm" data-act="goto" data-id="timeline">Full timeline for today</button>',
  ].join('');
}

export const VIEWS = {
  desk: { name: (S, ui) => S.t('agents').find((a) => a.id === ui.sub?.agent)?.name || 'Agent', accent: '#3aa0ff', render: deskPanel },
  record: { name: (S, ui) => { const [t, i] = String(ui.sub?.ref || '').split(':'); return `${({ approval: 'Approval', workflow: 'Workflow', task: 'Task', event: 'Event', order: 'Order', content: 'Content', ledger: 'Ledger entry', document: 'Document', call: 'Call', prospect: 'Lead', deal: 'Deal', deadline: 'Deadline', brand: 'Brand', product: 'Product', opportunity: 'Opportunity' })[t] || 'Record'} #${i || ''}`; }, accent: '#8592a5', render: recordPanel },
  monitor: { name: () => 'All Agents', accent: '#f2c14e', render: monitorPanel },
  timeline: { name: () => "Today's timeline", accent: '#5fd0e6', render: timelinePanel },
  since: { name: () => 'Since your last visit', accent: '#f2c14e', render: sincePanel },
  wall: { name: (S, ui) => ({ performance: 'Business performance', sales: 'Sales activity', commerce: 'Commerce & fulfillment', content: 'Content operations', attention: 'Attention required' }[ui.sub?.wall] || 'Wall'), accent: '#3aa0ff', render: wallPanel },
  'mode-money': { name: () => 'Money View', accent: '#2fd38a', render: moneyPanel },
  'mode-workflow': { name: () => 'Workflow View', accent: '#9b8cff', render: workflowPanel },
  'mode-customer': { name: () => 'Customer View', accent: '#7db7ff', render: customerPanel },
  'mode-health': { name: () => 'System Health', accent: '#8592a5', render: healthPanel },
  media: { name: () => 'Content Studio', accent: '#ff8bd1', render: contentPanel },
  team: { name: () => 'Projects & Team Requests', accent: '#f2c14e', render: teamPanel },
  links: { name: () => 'Live Links & Analytics', accent: '#7be0a8', render: linksPanel },
};
