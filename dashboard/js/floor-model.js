// Trading-floor model. Pure functions: records in, desk states / handoffs / ticker / walls out.
// Nothing here invents activity: every status, line and number is derived from a database row,
// and every derived item carries a `ref` to the record it came from. (Verified against Postgres in tests.)

export const STATUS = {
  working:          { key: 'working',          label: 'Working',                           color: '#3aa0ff', icon: '▶' },
  scheduled:        { key: 'scheduled',        label: 'Scheduled',                         color: '#5fd0e6', icon: '◷' },
  waiting_agent:    { key: 'waiting_agent',    label: 'Waiting on another agent',          color: '#9b8cff', icon: '⇄' },
  waiting_external: { key: 'waiting_external', label: 'Waiting on a customer or provider', color: '#f08a4b', icon: '⧗' },
  needs_approval:   { key: 'needs_approval',   label: 'Needs approval',                    color: '#f2c14e', icon: '!' },
  blocked:          { key: 'blocked',          label: 'Blocked or failed',                 color: '#ff5d5d', icon: '✕' },
  idle:             { key: 'idle',             label: 'Idle',                              color: '#6b778a', icon: '–' },
  paused:           { key: 'paused',           label: 'Paused',                            color: '#a3adbd', icon: 'Ⅱ' },
};
export const STATUS_ORDER = ['blocked', 'needs_approval', 'working', 'waiting_agent', 'waiting_external', 'scheduled', 'paused', 'idle'];

// Desk clusters on the floor. `exec` is the elevated glass Executive Office (the Big Boss = agent `manager`).
export const DEPTS = [
  { id: 'exec',       name: 'Executive Office',          short: 'Executive',   station: 'overview',   accent: '#f2c14e' },
  { id: 'agency',     name: 'Local Website Agency',      short: 'Agency',      station: 'agency',     accent: '#3aa0ff' },
  { id: 'sports',     name: 'Sports Platform Marketing', short: 'Sports',      station: 'sports',     accent: '#ff4f6d' },
  { id: 'etsy',       name: 'Etsy Commerce',             short: 'Etsy',        station: 'etsy',       accent: '#f08a4b' },
  { id: 'dropship',   name: 'Dropshipping Commerce',     short: 'Dropship',    station: 'dropship',   accent: '#2fd38a' },
  { id: 'realestate', name: 'Real Estate Wholesaling',   short: 'Real Estate', station: 'realestate', accent: '#c79bff' },
  { id: 'media',      name: 'Brands, Social & Video',    short: 'Content',     station: 'media',      accent: '#ff8bd1' },
  { id: 'ventures',   name: 'Research & New Ventures',   short: 'Ventures',    station: 'ventures',   accent: '#5fd0e6' },
  { id: 'customers',  name: 'Customer Operations',       short: 'Customers',   station: 'customers',  accent: '#7db7ff' },
  { id: 'finance',    name: 'Finance & Performance',     short: 'Finance',     station: 'finance',    accent: '#7be0a8' },
  { id: 'hq',         name: 'Risk & Workflow Improvement', short: 'Risk & Ops', station: 'overview',  accent: '#d9a441' },
  { id: 'career',     name: 'Career Office',             short: 'Career',      station: 'career',     accent: '#9fd3ff' },
];
export const deptById = Object.fromEntries(DEPTS.map((d) => [d.id, d]));
export const deptOf = (a) => (a.id === 'manager' || String(a.id).startsWith('ceo_') ? 'exec' : deptById[a.division] ? a.division : 'hq');
// Which business a department belongs to for pause purposes (divisions table id).
export const businessOf = (deptId) => (deptId === 'exec' ? 'hq' : deptId);

// Task labels (kept in sync with worker/src/agents/index.js `verbs`).
export const VERBS = {
  plan: 'Reviewing all divisions and assigning work', research: 'Researching a market question with cited sources', find_prospects: 'Finding local businesses',
  audit_site: 'Verifying and auditing a business website', design_page: 'Building a private website preview', check_site: 'Quality-checking a website preview',
  draft_email: 'Drafting outreach', run_followups: 'Checking who needs a follow-up', draft_proposal: 'Drafting a proposal', process_inbox: 'Reading new replies',
  prepare_call: 'Preparing a call script', record_outcome: 'Filing a call report', create_product: 'Drafting a product', build_digital_product: 'Producing a digital product and listing',
  research_products: 'Researching Etsy demand and economics', sync_orders: 'Syncing orders and shipments', sync_picks: 'Importing official picks', draft_content: 'Drafting sports marketing posts',
  propose_opportunities: 'Writing opportunity memos', plan_campaign: 'Planning a campaign', write_posts: 'Writing posts', research_niches: 'Researching dropshipping niches',
  evaluate_product: 'Scoring a product and its risks', find_suppliers: 'Verifying suppliers', build_listing: 'Building a product page', review_order: 'Reviewing an order',
  sync_shopify_orders: 'Checking tracking', market_report: 'Reading the local real estate market', import_leads: 'Importing property leads', underwrite: 'Underwriting a property',
  plan_outreach: 'Preparing seller outreach', prepare_offer: 'Preparing an offer for approval', match_buyers: 'Matching opt-in buyers', check_risks: 'Checking risk thresholds',
  allocation_report: 'Reviewing available cash', weekly_learning: 'Learning from results', design_experiment: 'Designing an experiment', find_bottlenecks: 'Looking for bottlenecks',
  propose_brand: 'Researching and proposing a brand', prepare_accounts: 'Preparing account setup checklists', check_accounts: 'Checking account connections',
  plan_calendar: 'Planning the content calendar', write_script: 'Researching and writing a script', produce: 'Producing a video', edit: 'Editing a video',
  package: 'Writing title and description', review: 'Quality-checking content', publish_due: 'Publishing scheduled content', measure: 'Measuring published content',
  morning_meeting: 'Running the morning meeting in the War Room', daily_run: 'Running the morning job-search routine', review_job: 'Preparing an application packet', find_contacts: 'Researching contacts at a company', check_replies: 'Checking for replies from employers', plan_idea: 'Planning your idea with the team', build_site: 'Building a landing page',
  check_comments: 'Reading comments', evaluate_brands: 'Checking brands against success criteria', brand_report: 'Writing a brand operating report',
};

// Recurring jobs from worker/src/index.js. Shown as "next scheduled action" only for what the code really schedules.
export const SCHEDULES = {
  manager: 'Morning meeting in the War Room daily 8:05 AM (MEETING_CRON); planning on MANAGER_CRON', support: 'Reads the inbox every 5 minutes', postmaster: 'Follow-up check hourly at :07',
  fulfillment: 'Order sync every 30 minutes', sports: 'Pick sync hourly at :12 (when connected)', risk: 'Risk check hourly at :20', finance: 'Morning text at the time you set',
  ds_orders: 'Tracking check every 30 minutes (when Shopify is connected)', learning: 'Mondays 6:00 AM', capital: 'Mondays 6:15 AM', improve: 'Mondays 6:30 AM',
  career: 'Weekdays 8:00 AM job-search routine; replies checked hourly 9:40 AM–6:40 PM',
  publisher: 'Publishing check every 10 minutes', growth: 'Metrics daily 7:40 AM; brand review Mondays 6:45 AM', community: 'Comments hourly at :25', account_prov: 'Account check every 6 hours',
};

// Stage names → plain English, and the planned order of stages per workflow kind (for "remaining steps").
export const STAGE_LABEL = {
  discovered: 'Lead found', lead: 'Lead', verify: 'Website audit', prepare_proposal: 'Preview build', quality_check: 'QA check', preview_fix: 'Preview fixes',
  prepare_outreach: 'Outreach drafting', approve_outreach: 'Outreach approval', follow_up: 'Awaiting reply', contact: 'Customer conversation', contacted: 'Contacted',
  replied: 'Replied', meeting: 'Meeting', proposal: 'Proposal approval', close: 'Awaiting payment', won: 'Won', lost: 'Lost', disqualified: 'Disqualified', closed: 'Closed',
  idea: 'Idea', creation: 'Creation', editing: 'Editing', packaging: 'Packaging', review: 'Quality review', scheduled: 'Scheduled', published: 'Published', measured: 'Measured',
  accounts: 'Account setup', approval: 'Approval', sample: 'Sample', listed: 'Listed', launch: 'Launch', product_selection: 'Product selection',
  professional_review: 'Professional review', offer_review: 'Offer review', offer_sent: 'Offer sent', under_contract: 'Under contract', due_diligence: 'Due diligence', cancelled: 'Cancelled',
};
export const stageLabel = (s) => STAGE_LABEL[s] || String(s || '').replace(/_/g, ' ');
export const STAGE_PLAN = {
  agency_lead: ['discovered', 'verify', 'prepare_proposal', 'quality_check', 'prepare_outreach', 'approve_outreach', 'follow_up', 'contact', 'proposal', 'close', 'won'],
  content_item: ['idea', 'creation', 'editing', 'review', 'scheduled', 'published', 'measured'],
  re_deal: ['lead', 'professional_review', 'contacted', 'offer_review', 'offer_sent', 'under_contract', 'due_diligence', 'closed'],
  brand: ['proposal', 'accounts', 'published', 'measured'],
};
// Stages where the next move belongs to a customer, supplier or platform.
export const EXTERNAL_WAIT = {
  follow_up: 'Waiting for the business to reply', close: 'Waiting for the customer\'s deposit payment', offer_sent: 'Waiting for the seller to respond',
  meeting: 'Meeting booked with the customer', sample: 'Waiting on a product sample', contacted: 'Waiting for the seller to respond',
};

const SUBJECT_KEYS = { prospect_id: 'prospect', order_id: 'order', deal_id: 're_deal', content_id: 'content', brand_id: 'brand', product_id: 'product' };
const ms = (iso) => (iso ? new Date(iso).getTime() : 0);

/** Name of a subject record, for plain-English task descriptions. */
export function subjectName(S, type, id) {
  if (id == null) return null;
  const f = (t, k = 'id') => S.t(t).find((r) => String(r[k]) === String(id));
  if (type === 'prospect') return f('prospects')?.name;
  if (type === 'order') return f('orders')?.external_id;
  if (type === 're_deal') { const d = f('re_deals'); return d ? S.t('properties').find((p) => p.id === d.property_id)?.address || `deal #${id}` : null; }
  if (type === 'content') return f('content_items')?.title || f('content_items')?.topic;
  if (type === 'brand') return f('brands')?.name;
  if (type === 'product') return f('ds_products')?.title || f('products')?.title;
  if (type === 'opportunity') return f('opportunities')?.title;
  return null;
}
export function taskSubject(S, task) {
  const input = task?.input || {};
  for (const [k, type] of Object.entries(SUBJECT_KEYS)) if (input[k] != null) {
    const t = type === 'product' && String(task.agent_id).startsWith('ds_') ? 'product' : type;
    return { type: t, id: input[k], name: subjectName(S, t, input[k]) };
  }
  if (input.topic) return { type: 'topic', name: String(input.topic).slice(0, 80) };
  if (input.category) return { type: 'search', name: `${input.category}${input.city ? ` in ${input.city}` : ''}` };
  return null;
}
const subjectMatches = (task, wf) => {
  if (!wf?.subject_type) return false;
  const input = task.input || {};
  if (input.workflow_id != null && Number(input.workflow_id) === Number(wf.id)) return true;
  return Object.entries(SUBJECT_KEYS).some(([k, type]) => type === wf.subject_type && input[k] != null && String(input[k]) === String(wf.subject_id));
};

/**
 * Desk state for every agent. One status per agent, decided in this order:
 * paused → working → blocked → needs approval → waiting on agent → waiting on customer/provider → scheduled → idle.
 * Each state carries `why` (the record(s) that justify it).
 */
export function deskStates(S, now = Date.now()) {
  const settings = S.t('settings')[0] || {};
  const pausedBiz = new Set(S.t('divisions').filter((d) => d.status === 'paused').map((d) => d.id));
  const tasks = S.t('tasks');
  const wfs = S.t('workflows');
  const approvals = S.t('approvals').filter((a) => a.status === 'pending');
  const out = {};
  const dayAgo = now - 864e5;

  for (const a of S.t('agents')) {
    const dept = deptOf(a);
    const mine = tasks.filter((t) => t.agent_id === a.id);
    const running = mine.filter((t) => t.status === 'running').sort((x, y) => ms(y.started_at) - ms(x.started_at))[0];
    const queued = mine.filter((t) => t.status === 'queued').sort((x, y) => ms(x.run_after || x.created_at) - ms(y.run_after || y.created_at));
    const lastFinished = mine.filter((t) => ['done', 'failed'].includes(t.status)).sort((x, y) => ms(y.finished_at || y.created_at) - ms(x.finished_at || x.created_at))[0];
    const failed = lastFinished?.status === 'failed' && ms(lastFinished.finished_at || lastFinished.created_at) > dayAgo ? lastFinished : null;
    const owned = wfs.filter((w) => w.owner_agent === a.id && ['active', 'waiting_approval', 'blocked'].includes(w.status));
    const myApprovals = approvals.filter((x) => x.agent_id === a.id);
    const calls = a.id === 'caller' ? S.t('call_tasks').filter((c) => c.status === 'ready' && c.mode !== 'ai') : [];
    const liveCall = a.id === 'caller' ? S.t('call_tasks').find((c) => c.status === 'calling' && c.mode === 'ai') : null;

    let status = 'idle', why = [], task = null, since = null, next = null, nextAt = null, needsYou = null, waitingOn = [], activity = null, refs = [];
    const focusWf = owned.find((w) => w.status === 'blocked') || owned.find((w) => w.status === 'waiting_approval') || owned[0] || null;

    // What's next, from the records (never guessed).
    if (queued[0]) { next = VERBS[queued[0].kind] || queued[0].kind; nextAt = queued[0].run_after; const sj = taskSubject(S, queued[0]); if (sj?.name) next += `: ${sj.name}`; }
    else if (focusWf?.next_action) { next = focusWf.next_action; nextAt = focusWf.next_action_at || null; }
    else if (SCHEDULES[a.id]) next = SCHEDULES[a.id];

    if (myApprovals.length) { needsYou = myApprovals.length === 1 ? `Approve: ${myApprovals[0].title}` : `${myApprovals.length} items waiting for your approval`; refs.push(...myApprovals.map((x) => `approval:${x.id}`)); }
    else if (calls.length) { needsYou = `Make ${calls.length === 1 ? 'the call to ' + (subjectName(S, 'prospect', calls[0].prospect_id) || calls[0].phone) : calls.length + ' calls'} (script ready)`; refs.push(...calls.map((c) => `call:${c.id}`)); }
    const ownerBlock = owned.find((w) => w.status === 'blocked' && /waiting for you|you need|owner/i.test(w.blockers || ''));
    if (!needsYou && ownerBlock) { needsYou = ownerBlock.blockers; refs.push(`workflow:${ownerBlock.id}`); }

    const bizPaused = pausedBiz.has(businessOf(dept)) || (dept === 'hq' && pausedBiz.has('hq'));
    if (settings.paused || bizPaused || a.enabled === false || a.status === 'paused') {
      status = 'paused';
      why.push(settings.paused ? 'All agents paused (Pause all)' : bizPaused ? 'This business is paused' : 'This agent is paused');
      if (running) { task = VERBS[running.kind] || running.kind; since = running.started_at; why.push(`Task #${running.id} was already running and will finish`); refs.push(`task:${running.id}`); }
    } else if (a.status === 'working' || running) {
      status = 'working';
      task = a.current_task || VERBS[running?.kind] || running?.kind || 'Working';
      if (running) {
        const sj = taskSubject(S, running); if (sj?.name) task += `: ${sj.name}`;
        since = running.started_at; refs.push(`task:${running.id}`); why.push(`Task #${running.id} is running`);
        activity = activityFor(a.id, running.kind);
      } else why.push('Agent row says working');
      if (liveCall) { activity = 'call'; refs.push(`call:${liveCall.id}`); }
    } else if (a.status === 'error' || failed || owned.some((w) => w.status === 'blocked' && w !== ownerBlock) || (a.status === 'waiting' && /budget/i.test(a.current_task || ''))) {
      status = 'blocked';
      const bw = owned.find((w) => w.status === 'blocked' && w !== ownerBlock);
      if (failed) { task = `Failed: ${VERBS[failed.kind] || failed.kind}`; why.push(`Task #${failed.id} failed: ${String(failed.error || '').slice(0, 140)}`); refs.push(`task:${failed.id}`); since = failed.finished_at; }
      else if (bw) { task = bw.objective; why.push(`Blocked: ${bw.blockers}`); refs.push(`workflow:${bw.id}`); since = bw.updated_at; }
      else if (a.status === 'waiting') { task = a.current_task; why.push(a.current_task); }
      else { task = 'Last task failed'; why.push('Agent row says error'); }
    } else if (needsYou) {
      status = 'needs_approval';
      task = myApprovals[0] ? myApprovals[0].title : focusWf?.objective || needsYou;
      since = myApprovals[0]?.created_at || calls[0]?.created_at || ownerBlock?.updated_at;
      why.push(needsYou);
    } else {
      // Waiting on another agent: it asked a teammate for something (a website, a brand, research...) that isn't finished.
      for (const r of S.t('work_requests').filter((x) => x.from_agent === a.id && ['queued', 'in_progress'].includes(x.status) && x.assigned_agent && x.assigned_agent !== a.id)) {
        waitingOn.push({ agent: r.assigned_agent, reason: `${r.title} (${r.status === 'queued' ? 'queued' : 'in progress'})`, workflow: r.workflow_id, task: r.task_id, request: r.id });
      }
      // Waiting on another agent: a workflow this agent owns has open work queued/running for a different agent.
      for (const w of owned) {
        const other = tasks.find((t) => t.agent_id !== a.id && ['queued', 'running'].includes(t.status) && subjectMatches(t, w));
        if (other) waitingOn.push({ agent: other.agent_id, reason: `${VERBS[other.kind] || other.kind} (${other.status})`, workflow: w.id, task: other.id });
      }
      const ext = owned.find((w) => w.status === 'active' && EXTERNAL_WAIT[w.stage]);
      const shipping = ['ds_orders', 'fulfillment'].includes(a.id) ? S.t('orders').filter((o) => o.status === 'fulfilling' && (a.id === 'ds_orders' ? o.division === 'dropship' : o.division === 'etsy')) : [];
      if (waitingOn.length) {
        status = 'waiting_agent'; const w0 = waitingOn[0];
        task = wfs.find((w) => w.id === w0.workflow)?.objective || (w0.request ? `Asked ${S.t('agents').find((x) => x.id === w0.agent)?.name || w0.agent}: ${w0.reason}` : null); since = wfs.find((w) => w.id === w0.workflow)?.updated_at;
        why.push(`Waiting on ${w0.agent}: ${w0.reason}`);
        if (w0.workflow) refs.push(`workflow:${w0.workflow}`); if (w0.task) refs.push(`task:${w0.task}`); if (w0.request) refs.push(`request:${w0.request}`);
      } else if (ext || shipping.length) {
        status = 'waiting_external';
        if (ext) { task = ext.objective; since = ext.updated_at; why.push(EXTERNAL_WAIT[ext.stage]); refs.push(`workflow:${ext.id}`); }
        else { task = `${shipping.length} order${shipping.length > 1 ? 's' : ''} with the supplier`; since = shipping[0].updated_at || shipping[0].created_at; why.push('Waiting on supplier acceptance / tracking'); refs.push(...shipping.map((o) => `order:${o.id}`)); }
      } else if (queued.length || owned.some((w) => w.next_action_at && ms(w.next_action_at) > now)) {
        status = 'scheduled';
        const q0 = queued[0];
        if (q0) { task = (VERBS[q0.kind] || q0.kind) + (taskSubject(S, q0)?.name ? `: ${taskSubject(S, q0).name}` : ''); since = q0.created_at; why.push(ms(q0.run_after) > now ? `Task #${q0.id} scheduled` : `Task #${q0.id} queued; starts when a worker slot frees up`); refs.push(`task:${q0.id}`); }
        else { const w = owned.find((x) => x.next_action_at && ms(x.next_action_at) > now); task = w.objective; why.push(`Next step scheduled: ${w.next_action}`); refs.push(`workflow:${w.id}`); }
      } else {
        status = 'idle';
        if (focusWf) { task = focusWf.objective; refs.push(`workflow:${focusWf.id}`); }
        why.push(lastFinished ? `Last finished ${VERBS[lastFinished.kind] || lastFinished.kind}` : 'No open work assigned');
        since = lastFinished?.finished_at || null;
      }
    }
    if (focusWf && !refs.includes(`workflow:${focusWf.id}`)) refs.push(`workflow:${focusWf.id}`);
    out[a.id] = {
      id: a.id, name: a.name, role: a.role, division: a.division, dept, status, statusLabel: STATUS[status].label, color: STATUS[status].color, icon: STATUS[status].icon,
      task, since, next, nextAt, needsYou, waitingOn, activity, refs, why, workflow: focusWf?.id || null, queued: queued.length, enabled: a.enabled !== false,
      isBoss: a.id === 'manager', isCeo: String(a.id).startsWith('ceo_'),
    };
  }
  return out;
}

/** Role-specific animation, only for a verified running task. Calls only when an AI call is actually connected. */
export function activityFor(agentId, kind) {
  if (['edit', 'produce'].includes(kind)) return 'editing_video';
  if (['check_site', 'review', 'audit_site', 'evaluate_product', 'underwrite', 'review_order', 'check_risks'].includes(kind)) return 'reviewing';
  return 'typing';
}

/** Handoffs between desks, only from explicit `handoff` workflow events (from → to recorded by the worker). */
export function handoffs(S, sinceMs = 0) {
  const wfs = Object.fromEntries(S.t('workflows').map((w) => [w.id, w]));
  return S.t('workflow_events')
    .filter((e) => e.type === 'handoff' && e.data?.from && e.data?.to && ms(e.created_at) >= sinceMs)
    .map((e) => {
      const wf = wfs[e.workflow_id];
      const m = String(e.message).match(/^([a-z_]+)(?: → ([a-z_]+))?/);
      const fromStage = m?.[1], toStage = e.data.stage || m?.[2];
      const label = e.data.by === 'owner' ? `Reassigned by you → ${e.data.to}` : fromStage && toStage && fromStage !== toStage ? `${stageLabel(fromStage)} complete → ${stageLabel(toStage).toLowerCase()}` : `Handed to ${e.data.to}`;
      return { id: e.id, from: e.data.from, to: e.data.to, label, at: e.created_at, workflow: e.workflow_id, objective: wf?.objective, ref: `workflow:${e.workflow_id}`, event: `wfevent:${e.id}` };
    })
    .sort((a, b) => ms(b.at) - ms(a.at));
}

// ---------------------------------------------------------------- ticker
const ROUTINE = /^(Hitting the books|Searching for|Checking |Sketching|Inspecting |Calling a town meeting|Researching |Designing |Reading |Evaluating |Retrying )/i;
export function eventKind(e) {
  const m = e.message || '';
  if (e.level === 'error' || /failed|gave up|could not/i.test(m)) return 'failure';
  if (/approv/i.test(m)) return 'approval';
  if (/payment|paid|revenue|invoice|\$\d/i.test(m) && /received|collected|payment/i.test(m)) return 'money';
  if (/order|shipment|tracking|supplier|fulfil/i.test(m)) return 'order';
  if (/deadline|option period|closing|contract/i.test(m)) return 'deadline';
  if (/publish|video|post|script|edit/i.test(m)) return 'content';
  if (/repl|opted out|call|meeting|proposal|email/i.test(m)) return 'sales';
  if (/prospect|lead/i.test(m)) return 'lead';
  return 'update';
}
export const eventPriority = (e) => (e.level === 'error' ? 'high' : e.level === 'warn' ? 'medium' : ROUTINE.test(e.message || '') ? 'routine' : 'normal');

/**
 * Ticker items from the events log (+ handoffs). Deduplicated: identical messages from the same agent within 30 minutes collapse into one with a count.
 * filter: { dept, priority: 'all'|'important', kind, business }
 */
export function ticker(S, filter = {}, limit = 40) {
  const agents = Object.fromEntries(S.t('agents').map((a) => [a.id, a]));
  const items = [];
  const seen = new Map();
  for (const e of [...S.t('events')].sort((a, b) => ms(b.created_at) - ms(a.created_at))) {
    const a = agents[e.agent_id] || { id: e.agent_id, division: 'hq' };
    const dept = a.id ? deptOf(a) : 'hq';
    const pr = eventPriority(e), kind = eventKind(e);
    if ((filter.priority || 'important') === 'important' && pr === 'routine') continue;
    if (filter.dept && filter.dept !== dept) continue;
    if (filter.kind && filter.kind !== kind) continue;
    const key = `${e.agent_id}|${String(e.message).replace(/\d+/g, '#')}`;
    const prev = seen.get(key);
    if (prev && ms(prev.at) - ms(e.created_at) < 30 * 60000) { prev.count++; prev.ids.push(e.id); continue; }
    const it = { id: e.id, ids: [e.id], at: e.created_at, agent: e.agent_id, agentName: a.name || e.agent_id, dept, deptName: deptById[dept]?.short || dept, priority: pr, kind, level: e.level, text: e.message, count: 1, ref: `event:${e.id}`, data: e.data || null };
    seen.set(key, it); items.push(it);
    if (items.length >= limit) break;
  }
  if (!filter.kind || filter.kind === 'handoff') for (const h of handoffs(S, Date.now() - 6 * 3600e3).slice(0, 10)) {
    const a = agents[h.to]; const dept = a ? deptOf(a) : 'hq';
    if (filter.dept && filter.dept !== dept) continue;
    items.push({ id: `h${h.id}`, ids: [], at: h.at, agent: h.to, agentName: a?.name || h.to, dept, deptName: deptById[dept]?.short || dept, priority: 'normal', kind: 'handoff', level: 'info', text: `${h.label} (${h.objective || 'workflow ' + h.workflow})`, count: 1, ref: h.ref, handoff: h });
  }
  return items.sort((a, b) => ms(b.at) - ms(a.at)).slice(0, limit);
}

// ---------------------------------------------------------------- walls
const n = (v) => Number(v || 0);
const sum = (rows, f) => rows.reduce((s, r) => s + n(r[f]), 0);
export function walls(S, now = Date.now()) {
  const d7 = new Date(now - 7 * 864e5).toISOString().slice(0, 10), d30 = new Date(now - 30 * 864e5).toISOString().slice(0, 10);
  const L7 = S.t('ledger').filter((r) => r.occurred_on >= d7);
  const pick = (L, cat, basis) => sum(L.filter((r) => r.category === cat && (!basis || r.basis === basis)), 'amount_usd');
  const ai7 = sum(S.t('usage').filter((u) => ms(u.created_at) >= now - 7 * 864e5), 'cost_usd');
  const collected = pick(L7, 'revenue', 'actual'), refunds = pick(L7, 'refund', 'actual'), ads = pick(L7, 'ad_spend'), ful = pick(L7, 'fulfillment'), fees = pick(L7, 'fees'), soft = pick(L7, 'software');
  const byBiz = {};
  for (const r of L7) { const k = r.division || 'other'; byBiz[k] ||= { collected: 0, costs: 0 }; if (r.category === 'revenue' && r.basis === 'actual') byBiz[k].collected += n(r.amount_usd); else if (!['revenue', 'commitment', 'refund'].includes(r.category)) byBiz[k].costs += n(r.amount_usd); }
  const proposals = S.t('projects').filter((p) => ['proposal', 'awaiting_signature', 'awaiting_payment'].includes(p.status));
  const reOpen = S.t('re_deals').filter((d) => ['under_contract', 'due_diligence', 'marketing', 'buyer_selected', 'assignment_signed', 'closing'].includes(d.stage));
  const P = S.t('prospects');
  const calls = S.t('call_tasks');
  const connected = calls.filter((c) => c.outcome && !['no_answer', 'voicemail', 'wrong_number'].includes(c.outcome));
  const O = S.t('orders');
  const C = S.t('content_items');
  const pend = S.t('approvals').filter((a) => a.status === 'pending');
  const settings = S.t('settings')[0] || {};
  const aiToday = sum(S.t('usage').filter((u) => ms(u.created_at) >= new Date(new Date(now).setHours(0, 0, 0, 0)).getTime()), 'cost_usd');
  const st = stalls(S, now);
  const metrics = S.t('brand_metrics');
  return {
    performance: {
      collected: { v: collected, basis: 'actual', label: 'Revenue collected (7d)' },
      contribution: { v: collected - refunds - ads - ful - fees - soft - ai7, basis: 'estimated', label: 'Contribution profit (7d, estimate)' },
      costs: { v: ads + ful + fees + soft + ai7, basis: 'estimated', label: 'Advertising & operating costs (7d)', parts: { ads, fulfillment: ful, fees, software: soft, ai: ai7 } },
      commitments: { v: pick(S.t('ledger').filter((r) => r.occurred_on >= d30), 'commitment'), basis: 'forecast', label: 'Cash commitments (30d)' },
      pipeline: { v: sum(proposals, 'price_usd') + sum(reOpen, 'fee_estimate_usd'), basis: 'forecast', label: 'Pipeline value (NOT revenue)' },
      byBusiness: byBiz,
    },
    sales: {
      qualified: { v: P.filter((p) => n(p.lead_score) >= 60 && !['disqualified', 'lost'].includes(p.deal_stage) && !p.opted_out).length, label: 'Qualified leads' },
      connectedCalls: { v: connected.length, label: 'Connected calls' },
      meetings: { v: calls.filter((c) => c.outcome === 'meeting_booked').length + P.filter((p) => p.deal_stage === 'meeting').length, label: 'Meetings booked' },
      proposalsAwaiting: { v: proposals.length, label: 'Proposals awaiting response' },
      signed: { v: S.t('projects').filter((p) => ['onboarding', 'building', 'qa', 'delivered', 'support'].includes(p.status)).length, label: 'Signed / paid agreements' },
    },
    commerce: {
      newPaid: { v: O.filter((o) => ['new', 'validated'].includes(o.status)).length, label: 'New paid orders' },
      awaitingSupplier: { v: O.filter((o) => o.status === 'fulfilling').length, label: 'Awaiting supplier' },
      inTransit: { v: O.filter((o) => o.status === 'shipped').length, label: 'In transit' },
      exceptions: { v: O.filter((o) => o.status === 'exception').length, label: 'Delivery exceptions / holds' },
      refunds: { v: O.filter((o) => o.status === 'refunded').length, label: 'Refunds' },
      support: { v: S.t('conversations').filter((c) => !['resolved', 'closed'].includes(c.status)).length, label: 'Unresolved support cases' },
    },
    content: {
      inProduction: { v: C.filter((c) => ['creation', 'editing', 'review', 'packaging'].includes(c.stage)).length, label: 'Videos being created or edited' },
      awaitingApproval: { v: pend.filter((a) => ['content', 'content_publish', 'social_post', 'brand_content'].includes(a.kind)).length + C.filter((c) => c.status === 'pending_approval').length, label: 'Posts awaiting approval' },
      upcoming: { v: C.filter((c) => c.stage === 'scheduled' && ms(c.scheduled_at) > now).length, label: 'Upcoming scheduled posts' },
      published: { v: C.filter((c) => (c.stage === 'published' || c.stage === 'measured' || c.status === 'published') && (c.live_url || c.assets?.live_url)).length, label: 'Verified published' },
      views: { v: metrics.length ? sum(metrics, 'views') : null, label: 'Measured views', basis: metrics.length ? 'actual' : 'na' },
      attributed: { v: null, label: 'Attributed leads & sales', basis: 'na', note: 'No attribution source connected yet' },
    },
    attention: {
      approvals: { v: pend.length, label: 'Approvals waiting' },
      integrations: { v: S.t('integrations').filter((i) => i.status === 'error').length, label: 'Failed integrations' },
      budget: { v: (aiToday >= n(settings.daily_budget_usd || 5) * 0.9 ? 1 : 0) + S.t('authorities').filter((x) => x.status === 'active' && n(x.budget_usd) > 0 && n(x.spent_usd) >= n(x.budget_usd)).length, label: 'Budget limits reached' },
      escalations: { v: S.t('conversations').filter((c) => c.status === 'escalated' || c.urgent).length, label: 'Customer escalations' },
      deadlines: { v: S.t('deadlines').filter((d) => d.status === 'open' && ms(d.due_at) - now < 7 * 864e5).length, label: 'Real estate deadlines (7d)' },
      stalled: { v: st.length, label: 'Stalled workflows' },
    },
  };
}

/** Work that has stopped progressing beyond its expected timeframe. The basis for each limit is stated. */
export const STALL_RULES = {
  task_running_min: 20,      // worker times tasks out at 12 minutes (TASK_TIMEOUT_MIN); 20 means it's stuck
  task_queued_min: 60,       // due tasks normally start within a minute or two
  approval_hours: 72,        // waiting on you
  external_days: 10,         // customer/provider waits (follow-ups run on day 4 and 10)
  active_hours: 48,          // an active workflow with no update for two days
  overdue_hours: 2,          // next_action_at passed
};
export function stalls(S, now = Date.now()) {
  const out = [];
  for (const t of S.t('tasks')) {
    if (t.status === 'running' && t.started_at && now - ms(t.started_at) > STALL_RULES.task_running_min * 60000) out.push({ ref: `task:${t.id}`, agent: t.agent_id, what: `${VERBS[t.kind] || t.kind} running for ${Math.round((now - ms(t.started_at)) / 60000)} min`, rule: `Tasks time out at 12 min; flagged after ${STALL_RULES.task_running_min}` });
    if (t.status === 'queued' && ms(t.run_after || t.created_at) < now - STALL_RULES.task_queued_min * 60000) out.push({ ref: `task:${t.id}`, agent: t.agent_id, what: `${VERBS[t.kind] || t.kind} waiting to start for ${Math.round((now - ms(t.run_after || t.created_at)) / 60000)} min`, rule: `Due tasks usually start within minutes; flagged after ${STALL_RULES.task_queued_min}` });
  }
  for (const w of S.t('workflows')) {
    if (!['active', 'waiting_approval'].includes(w.status)) continue;
    const age = now - ms(w.updated_at);
    const limit = w.status === 'waiting_approval' ? STALL_RULES.approval_hours * 3600e3 : EXTERNAL_WAIT[w.stage] ? STALL_RULES.external_days * 864e5 : STALL_RULES.active_hours * 3600e3;
    if (age > limit) out.push({ ref: `workflow:${w.id}`, agent: w.owner_agent, what: `${w.objective}: no progress for ${Math.round(age / 3600e3)}h (stage: ${stageLabel(w.stage)})`, rule: w.status === 'waiting_approval' ? `Waiting on your approval > ${STALL_RULES.approval_hours}h` : EXTERNAL_WAIT[w.stage] ? `Customer/provider wait > ${STALL_RULES.external_days} days` : `No update > ${STALL_RULES.active_hours}h` });
    else if (w.next_action_at && now - ms(w.next_action_at) > STALL_RULES.overdue_hours * 3600e3) out.push({ ref: `workflow:${w.id}`, agent: w.owner_agent, what: `${w.objective}: "${w.next_action}" is overdue`, rule: `Next step more than ${STALL_RULES.overdue_hours}h past due` });
  }
  return out;
}

/** Department workload: counts by status plus queue depth. */
export function workload(S, desks) {
  const out = {};
  for (const d of DEPTS) out[d.id] = { total: 0, working: 0, queued: 0, needs: 0, blocked: 0, waiting: 0, paused: 0 };
  for (const s of Object.values(desks)) {
    const w = out[s.dept]; if (!w) continue;
    w.total++; w.queued += s.queued;
    if (s.status === 'working') w.working++;
    if (s.status === 'needs_approval' || s.needsYou) w.needs++;
    if (s.status === 'blocked') w.blocked++;
    if (s.status === 'waiting_agent' || s.status === 'waiting_external') w.waiting++;
    if (s.status === 'paused') w.paused++;
  }
  return out;
}

/** Who is waiting on whom (agents, you, customers/providers). */
export function dependencies(desks) {
  const out = [];
  for (const s of Object.values(desks)) {
    for (const w of s.waitingOn) out.push({ agent: s.id, on: w.agent, kind: 'agent', reason: w.reason, ref: w.request ? `request:${w.request}` : `workflow:${w.workflow}` });
    if (s.needsYou) out.push({ agent: s.id, on: 'you', kind: 'owner', reason: s.needsYou, ref: s.refs[0] });
    if (s.status === 'waiting_external') out.push({ agent: s.id, on: 'customer/provider', kind: 'external', reason: s.why[0], ref: s.refs[0] });
  }
  return out;
}

/** "What changed since my last visit?" Counts and lists, each with a record ref. */
export function sinceLastVisit(S, sinceIso) {
  const t = ms(sinceIso) || Date.now() - 864e5;
  const after = (r, f = 'created_at') => ms(r[f]) > t;
  const evs = S.t('events').filter((e) => after(e));
  const done = S.t('tasks').filter((x) => x.status === 'done' && after(x, 'finished_at'));
  const failed = S.t('tasks').filter((x) => x.status === 'failed' && after(x, 'finished_at'));
  const newAppr = S.t('approvals').filter((a) => after(a));
  const executed = S.t('approvals').filter((a) => a.status === 'executed' && after(a, 'executed_at'));
  const money = S.t('ledger').filter((r) => r.category === 'revenue' && r.basis === 'actual' && after(r));
  const hs = handoffs(S, t);
  const published = S.t('content_items').filter((c) => c.published_at && after(c, 'published_at'));
  const orders = S.t('orders').filter((o) => after(o));
  return {
    since: new Date(t).toISOString(),
    counts: { events: evs.length, tasksDone: done.length, failures: failed.length, newApprovals: newAppr.length, executed: executed.length, collected: sum(money, 'amount_usd'), handoffs: hs.length, published: published.length, orders: orders.length },
    highlights: [
      ...money.map((r) => ({ text: `Collected $${n(r.amount_usd).toFixed(2)} (${r.division}, ${r.source})`, ref: `ledger:${r.id}`, at: r.created_at, tone: 'up' })),
      ...executed.map((a) => ({ text: `Done: ${a.title}`, ref: `approval:${a.id}`, at: a.executed_at, tone: 'ok' })),
      ...failed.map((x) => ({ text: `Failed: ${VERBS[x.kind] || x.kind} (${x.agent_id})`, ref: `task:${x.id}`, at: x.finished_at, tone: 'down' })),
      ...newAppr.filter((a) => a.status === 'pending').map((a) => ({ text: `Needs approval: ${a.title}`, ref: `approval:${a.id}`, at: a.created_at, tone: 'gold' })),
      ...published.map((c) => ({ text: `Published: ${c.title || 'content'}`, ref: `content:${c.id}`, at: c.published_at, tone: 'ok' })),
      ...orders.map((o) => ({ text: `Order ${o.external_id} (${o.status})`, ref: `order:${o.id}`, at: o.created_at, tone: '' })),
    ].sort((a, b) => ms(b.at) - ms(a.at)).slice(0, 20),
  };
}

/** Today's timeline (Central time), newest first, from events + handoffs + approvals decided. */
export function timeline(S, now = Date.now()) {
  const start = new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Chicago' }));
  start.setHours(0, 0, 0, 0);
  const offset = new Date(now).getTime() - new Date(new Date(now).toLocaleString('en-US', { timeZone: 'America/Chicago' })).getTime();
  const t0 = start.getTime() + offset;
  const items = [
    ...S.t('events').filter((e) => ms(e.created_at) >= t0 && eventPriority(e) !== 'routine').map((e) => ({ at: e.created_at, text: e.message, agent: e.agent_id, ref: `event:${e.id}`, kind: eventKind(e), level: e.level })),
    ...handoffs(S, t0).map((h) => ({ at: h.at, text: `${h.from} → ${h.to}: ${h.label}`, agent: h.to, ref: h.ref, kind: 'handoff', level: 'info' })),
    ...S.t('approvals').filter((a) => a.decided_at && ms(a.decided_at) >= t0).map((a) => ({ at: a.decided_at, text: `You ${a.status === 'rejected' ? 'rejected' : 'approved'}: ${a.title}`, agent: a.agent_id, ref: `approval:${a.id}`, kind: 'approval', level: 'info' })),
  ];
  return items.sort((a, b) => ms(b.at) - ms(a.at));
}

/** Big Boss briefing: each line links to the record it summarizes. */
export function briefing(S, sinceIso, now = Date.now()) {
  const desks = deskStates(S, now);
  const W = walls(S, now);
  const plan = S.t('documents').find((d) => d.kind === 'manager_plan');
  const boss = desks.manager;
  const working = Object.values(desks).filter((d) => d.status === 'working');
  const blocked = Object.values(desks).filter((d) => d.status === 'blocked');
  const pend = S.t('approvals').filter((a) => a.status === 'pending').sort((a, b) => ms(a.created_at) - ms(b.created_at));
  return {
    now: { boss: boss ? { status: boss.statusLabel, task: boss.task, ref: boss.refs[0] } : null, working: working.map((d) => ({ text: `${d.name}: ${d.task}`, ref: `agent:${d.id}` })) },
    since: sinceLastVisit(S, sinceIso),
    money: W.performance,
    blocked: [...blocked.map((d) => ({ text: `${d.name}: ${d.why[0]}`, ref: d.refs[0] || `agent:${d.id}` })), ...stalls(S, now).map((s) => ({ text: s.what, ref: s.ref }))],
    approvals: pend.map((a) => ({ text: a.title, ref: `approval:${a.id}`, at: a.created_at })),
    plan: plan ? { title: plan.title, body: plan.body, at: plan.created_at, ref: `document:${plan.id}` } : null,
  };
}

/** Local command-bar intents (no AI). Returns { action, args, label } or null. Execution goes through the app's normal controls. */
export function parseCommand(text) {
  const t = String(text || '').toLowerCase().trim();
  if (!t) return null;
  const dept = DEPTS.find((d) => t.includes(d.short.toLowerCase()) || t.includes(d.id) || t.includes(d.name.toLowerCase()));
  if (/^(pause|resume) (all|everything)/.test(t)) return { action: 'pause-all', label: t.startsWith('pause') ? 'Pause all agents' : 'Resume all agents' };
  if (/^(pause|resume) /.test(t) && dept) return { action: 'pause-business', args: { id: businessOf(dept.id), to: t.startsWith('pause') ? 'paused' : 'active' }, label: `${t.startsWith('pause') ? 'Pause' : 'Resume'} ${dept.name}` };
  if (/block|fail|stuck|stall/.test(t)) return { action: 'view', args: { mode: 'workflow', filter: /order/.test(t) ? 'blocked-orders' : 'blocked' }, label: 'Show blocked and stalled work' };
  if (/approv|need(s)? (me|you)|decision/.test(t)) return { action: 'view', args: { mode: 'approvals' }, label: 'Open approvals' };
  if (/call/.test(t)) return { action: 'view', args: { mode: 'customer', filter: 'calls' }, label: "Open today's calls" };
  if (/order|shipping|fulfil|supplier/.test(t)) return { action: 'view', args: { mode: 'customer', filter: 'orders' }, label: 'Show orders' };
  if (/money|revenue|profit|cost|margin|cash/.test(t)) return { action: 'view', args: { mode: 'money' }, label: 'Open Money View' };
  if (/video|content|post|script|publish/.test(t)) return { action: 'view', args: { mode: 'content' }, label: 'Open Content Studio' };
  if (/health|integration|queue|error|stale/.test(t)) return { action: 'view', args: { mode: 'health' }, label: 'Open System Health' };
  if (/workflow|handoff|pipeline|depend/.test(t)) return { action: 'view', args: { mode: 'workflow' }, label: 'Open Workflow View' };
  if (/changed|since|missed|catch up/.test(t)) return { action: 'since', label: 'What changed since my last visit' };
  if (/boss|executive|office/.test(t)) return { action: 'exec', label: 'Go to the Executive Office' };
  if (/agents|who.*(working|doing)|monitor/.test(t)) return { action: 'monitor', label: 'Open All Agents monitor' };
  if (dept) return { action: 'dept', args: { id: dept.id }, label: `Go to ${dept.name}` };
  return { action: 'ask', label: `Ask the Big Boss: "${text.trim().slice(0, 60)}"` };
}

// ---------------------------------------------------------------- War Room
// The daily morning meeting comes from the `meetings` table only. Agents are shown in the War Room while the
// meeting row is in session, and for a few minutes after it ends (labeled "wrap-up"). Nothing is staged.
export const MEETING_WRAP_MS = 5 * 60000;
const MEETING_STALE_MS = 20 * 60000;
export function meetingState(S, now = Date.now()) {
  const rows = S.t('meetings');
  const m = rows.slice().sort((a, b) => String(b.held_on).localeCompare(String(a.held_on)) || ms(b.started_at) - ms(a.started_at))[0];
  if (!m) return null;
  const lines = m.notes?.lines || [];
  const ended = m.ended_at ? ms(m.ended_at) : 0;
  const inSession = m.status === 'in_session' && now - ms(m.started_at) < MEETING_STALE_MS;
  const wrap = !inSession && m.status === 'done' && ended && now - ended < MEETING_WRAP_MS;
  return {
    id: m.id, held_on: m.held_on, status: m.status, started_at: m.started_at, ended_at: m.ended_at, error: m.error,
    phase: inSession ? 'in_session' : wrap ? 'wrap_up' : m.status === 'in_session' ? 'stalled' : m.status,
    until: inSession ? ms(m.started_at) + MEETING_STALE_MS : wrap ? ended + MEETING_WRAP_MS : 0,
    inRoom: !!(inSession || wrap), attendees: m.attendees || [], lines,
    speaking: inSession ? (lines.length ? lines[lines.length - 1].agent : 'manager') : null,
    focus: m.notes?.focus || '', decisions: m.notes?.decisions || [], requests: m.notes?.requests || [], plain_english: m.notes?.plain_english || '',
    source: m.notes?.source || '', document_id: m.document_id, history: rows.length,
  };
}
