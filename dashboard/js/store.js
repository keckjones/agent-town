// Data layer. LiveStore reads/writes your Supabase project with live updates.
// DemoStore is fully isolated sample data: it never talks to Supabase, and every action says "Demo".

const TABLES = {
  agents: { order: ['id'] },
  events: { order: ['created_at', false], limit: 150 },
  approvals: { order: ['created_at', false], limit: 300 },
  workflows: { order: ['updated_at', false], limit: 400 },
  workflow_events: { order: ['created_at', false], limit: 400 },
  integrations: { order: ['id'] },
  ledger: { order: ['occurred_on', false], limit: 3000 },
  prospects: { cols: 'id,name,category,address,city,phone,website,email,rating,review_count,stage,deal_stage,site_score,lead_score,scores,audit,contact_sources,old_screenshot,new_screenshot,new_html,comparison,next_step,next_step_at,followups_sent,last_contacted_at,replied_at,opted_out,deal_value,verified_no_website,updated_at,created_at', order: ['updated_at', false], limit: 400 },
  outreach_messages: { order: ['created_at', false], limit: 300 },
  call_tasks: { order: ['created_at', false], limit: 150 },
  projects: { order: ['created_at', false], limit: 100 },
  invoices: { order: ['created_at', false], limit: 100 },
  customers: { order: ['created_at', false], limit: 200 },
  conversations: { order: ['last_message_at', false], limit: 200 },
  messages: { order: ['created_at', false], limit: 400 },
  sms_messages: { order: ['created_at', false], limit: 40 },
  notify_settings: {},
  settings: {},
  sports_snapshots: { order: ['fetched_at', false], limit: 1 },
  sports_picks: { order: ['kickoff', false], limit: 100 },
  content_items: { order: ['created_at', false], limit: 150 },
  channels: { order: ['id'] },
  products: { order: ['created_at', false], limit: 100 },
  orders: { order: ['created_at', false], limit: 400 },
  ds_products: { order: ['created_at', false], limit: 100 },
  suppliers: { order: ['created_at', false], limit: 100 },
  supplier_quotes: { order: ['observed_at', false], limit: 200 },
  re_jurisdictions: {},
  properties: { order: ['created_at', false], limit: 300 },
  re_deals: { order: ['updated_at', false], limit: 300 },
  deadlines: { order: ['due_at'], limit: 200 },
  buyers: { order: ['created_at', false], limit: 300 },
  deal_documents: { order: ['created_at', false], limit: 200 },
  opportunities: { order: ['created_at', false], limit: 100 },
  experiments: { order: ['created_at', false], limit: 100 },
  documents: { cols: 'id,agent_id,kind,title,body,created_at', order: ['created_at', false], limit: 120 },
  authorities: { order: ['created_at', false], limit: 100 },
  campaigns: { order: ['created_at', false], limit: 100 },
  suppression: { order: ['created_at', false], limit: 500 },
  cash_reserves: {},
  risk_thresholds: {},
  divisions: { order: ['sort'] },
  usage: { cols: 'cost_usd,created_at,agent_id,service', order: ['created_at', false], limit: 3000, since: 31 },
  tasks: { cols: 'id,agent_id,kind,status,error,input,result,created_by,run_after,created_at,started_at,finished_at,attempts', order: ['created_at', false], limit: 400 },
  brands: { order: ['created_at', false], limit: 50 },
  brand_accounts: { order: ['id'] },
  brand_metrics: { order: ['observed_on', false], limit: 500 },
  commands: { order: ['created_at', false], limit: 50 },
  team_projects: { order: ['created_at', false], limit: 50 },
  work_requests: { order: ['created_at', false], limit: 200 },
  sites: { order: ['created_at', false], limit: 100 },
};

export function createLiveStore(sb) {
  const tables = {};
  let notify = () => {}, onEvent = () => {};
  const timers = {};
  const missing = new Set();
  // Connection: realtime channel state + time of the last successful load or live message.
  const conn = { state: 'connecting', label: 'connecting', last: 0 };
  const mark = () => { conn.last = Date.now(); };

  async function load(name) {
    const c = TABLES[name];
    let q = sb.from(name).select(c.cols || '*');
    if (c.since) q = q.gte('created_at', new Date(Date.now() - c.since * 864e5).toISOString());
    if (c.order) q = q.order(c.order[0], { ascending: c.order[1] !== false });
    if (c.limit) q = q.limit(c.limit);
    const { data, error } = await q;
    if (error) { missing.add(name); tables[name] = []; return; }
    missing.delete(name);
    tables[name] = data || [];
    mark();
  }
  const reload = (name) => { clearTimeout(timers[name]); timers[name] = setTimeout(async () => { await load(name); notify(name); }, 350); };
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  return {
    demo: false, tables, missing,
    conn: () => ({ ...conn }),
    t: (n) => tables[n] || [],
    async init(onChange, onNewEvent) {
      notify = onChange; onEvent = onNewEvent;
      await Promise.all(Object.keys(TABLES).map(load));
      const ch = sb.channel('command-center');
      for (const name of Object.keys(TABLES)) {
        if (['usage', 'ledger'].includes(name)) continue;
        ch.on('postgres_changes', { event: '*', schema: 'public', table: name }, (p) => {
          mark();
          if (name === 'events' && p.eventType === 'INSERT') { tables.events = [p.new, ...(tables.events || [])].slice(0, 150); onEvent(p.new); notify('events'); return; }
          if (name === 'agents' && p.new) { const i = tables.agents.findIndex((a) => a.id === p.new.id); if (i >= 0) tables.agents[i] = p.new; else tables.agents.push(p.new); notify('agents'); return; }
          reload(name);
        });
      }
      ch.subscribe((status) => {
        conn.state = status === 'SUBSCRIBED' ? 'live' : 'polling';
        conn.label = status === 'SUBSCRIBED' ? 'realtime connected' : `realtime ${String(status).toLowerCase()}; polling every 30s`;
        notify('conn');
      });
      setInterval(() => { reload('usage'); reload('ledger'); }, 60000);
      // Sensible polling: a cheap heartbeat always; the core tables too whenever realtime isn't connected.
      setInterval(async () => {
        await load('agents'); notify('agents');
        if (conn.state !== 'live') for (const t of ['tasks', 'approvals', 'workflows', 'workflow_events', 'events', 'orders', 'divisions']) reload(t);
      }, 30000);
    },
    reload,
    async update(table, match, patch) { let q = sb.from(table).update(patch); for (const [k, v] of Object.entries(match)) q = q.eq(k, v); must(await q); reload(table); },
    async insert(table, row) { const d = must(await sb.from(table).insert(row).select()); reload(table); return d?.[0]; },
    async upsert(table, row, onConflict) { must(await sb.from(table).upsert(row, onConflict ? { onConflict } : undefined)); reload(table); },
    async remove(table, match) { let q = sb.from(table).delete(); for (const [k, v] of Object.entries(match)) q = q.eq(k, v); must(await q); reload(table); },
    async command(kind, input = {}) {
      const row = must(await sb.from('commands').insert({ kind, input }).select())[0]; reload('commands');
      // Don't rely on live updates alone: check this command every 3 seconds until the worker finishes it (max 3 minutes).
      const t0 = Date.now();
      const poll = setInterval(async () => {
        const { data } = await sb.from('commands').select('*').eq('id', row.id).maybeSingle();
        if (data) { const i = (tables.commands || []).findIndex((c) => c.id === data.id); if (i >= 0) tables.commands[i] = data; else (tables.commands ||= []).unshift(data); notify('commands'); }
        if (data && ['done', 'failed'].includes(data.status)) for (const t of ['approvals', 'team_projects', 'work_requests', 'tasks']) reload(t);
        if (!data || ['done', 'failed'].includes(data.status) || Date.now() - t0 > 180000) clearInterval(poll);
      }, 3000);
      return row;
    },
    async runTask(agent, kind, input = {}) { return this.command('run_task', { agent, kind, input }); },
    async fileUrl(path) { if (!path) return null; const { data } = await sb.storage.from('town-files').createSignedUrl(path, 3600); return data?.signedUrl || null; },
    async fileText(path) { const { data } = await sb.storage.from('town-files').download(path); return data ? data.text() : ''; },
    async signOut() { await sb.auth.signOut(); location.reload(); },
  };
}

// ---------------------------------------------------------------- DEMO (isolated, labeled)
// Simulates the worker with the same records the real one writes (a task row runs, the agent row says working,
// an event is logged, the task finishes, sometimes a workflow hands off), so the floor shows only what the data says.
export function createDemoStore(seed) {
  const tables = seed();
  let notify = () => {}, onEvent = () => {}, nextId = 100000;
  const toast = () => window.__toast?.('Demo mode: nothing was sent or saved.');
  const match = (row, m) => Object.entries(m).every(([k, v]) => String(row[k]) === String(v));
  const now = () => new Date().toISOString();
  const SCRIPT = [
    { agent: 'scout', kind: 'find_prospects', input: { category: 'hair salon', city: 'Bryan, TX' }, start: 'Searching for hair salon businesses in Bryan, TX...', done: ['Found 6 new hair salon prospects in Bryan, TX (sample).', 'success'] },
    { agent: 'inspector', kind: 'audit_site', input: { prospect_id: 3 }, start: 'Inspecting http://sample-salon.test...', done: ['Sample Salon: site scored 48/100, lead score 66 (sample).', 'info'] },
    { agent: 'designer', kind: 'design_page', input: { prospect_id: 2 }, start: 'Sketching a new homepage for Sample Auto Care...', done: ['Private preview for Sample Auto Care is ready. Sending it to Quality Assurance.', 'success'], handoff: { wf: 5, from: 'designer', to: 'qa', msg: 'prepare_proposal → quality_check: handed to qa', stage: 'quality_check' } },
    { agent: 'qa', kind: 'check_site', input: { prospect_id: 2 }, start: 'Checking Sample Auto Care\'s new page on phone and desktop...', done: ['Sample Auto Care\'s preview passed QA (15 checks).', 'success'], handoff: { wf: 5, from: 'qa', to: 'caller', msg: 'quality_check → prepare_outreach: handed to caller', stage: 'prepare_outreach' } },
    { agent: 'editor', kind: 'edit', input: { content_id: 2 }, start: 'Editing "Sample: 3 cable fixes"...', done: ['Edit v2 ready for review (sample).', 'success'], handoff: { wf: 6, from: 'editor', to: 'content_qa', msg: 'editing → review: handed to content_qa', stage: 'review' } },
    { agent: 'ds_orders', kind: 'review_order', input: { order_id: 2 }, start: 'Reviewing order shopify:sample1043...', done: ['Order shopify:sample1043 routed to the supplier (31% margin, sample).', 'success'] },
    { agent: 're_underwrite', kind: 'underwrite', input: { deal_id: 1 }, start: 'Underwriting Sample 12 Pine St...', done: ['Max offer $110,000 (medium confidence, sample).', 'info'] },
    { agent: 'support', kind: 'process_inbox', input: {}, start: 'Reading new replies...', done: ['No new replies (sample).', 'info'] },
  ];
  let step = 0;
  function emit(agent_id, message, level = 'info') { const ev = { id: nextId++, agent_id, message, level, created_at: now() }; tables.events.unshift(ev); tables.events.length = Math.min(150, tables.events.length); onEvent(ev); }
  function tick() {
    const sc = SCRIPT[step++ % SCRIPT.length];
    const a = tables.agents.find((x) => x.id === sc.agent);
    if (!a || a.enabled === false || (tables.settings[0] || {}).paused || tables.divisions.find((d) => d.id === a.division)?.status === 'paused') return;
    const t = { id: nextId++, agent_id: sc.agent, kind: sc.kind, input: sc.input, status: 'running', created_by: 'demo', created_at: now(), started_at: now(), attempts: 1 };
    tables.tasks.unshift(t);
    a.status = 'working'; a.current_task = null;
    emit(sc.agent, sc.start);
    notify('tasks'); notify('agents'); notify('events');
    setTimeout(() => {
      t.status = 'done'; t.finished_at = now(); t.result = { demo: true };
      a.status = 'idle'; a.current_task = null;
      emit(sc.agent, sc.done[0], sc.done[1]);
      if (sc.handoff) {
        const w = tables.workflows.find((x) => x.id === sc.handoff.wf);
        if (w) { w.owner_agent = sc.handoff.to; w.stage = sc.handoff.stage; w.updated_at = now(); }
        tables.workflow_events.unshift({ id: nextId++, workflow_id: sc.handoff.wf, agent_id: sc.handoff.from, type: 'handoff', message: sc.handoff.msg, data: { from: sc.handoff.from, to: sc.handoff.to, stage: sc.handoff.stage }, created_at: now() });
        notify('workflow_events'); notify('workflows');
      }
      notify('tasks'); notify('agents'); notify('events');
    }, 7000);
  }
  return {
    demo: true, tables, missing: new Set(),
    conn: () => ({ state: 'demo', label: 'demonstration data (no connection)', last: Date.now() }),
    t: (n) => tables[n] || [],
    async init(onChange, onNewEvent) {
      notify = onChange; onEvent = onNewEvent;
      setTimeout(tick, 1500);
      setInterval(tick, 9000);
    },
    reload: () => {},
    async update(table, m, patch) { for (const r of tables[table] || []) if (match(r, m)) Object.assign(r, patch); notify(table); toast(); },
    async insert(table, row) { const r = { id: nextId++, created_at: now(), ...row }; (tables[table] ||= []).unshift(r); notify(table); if (table !== 'commands') toast(); return r; },
    async upsert(table, row) { return this.insert(table, row); },
    async remove(table, m) { tables[table] = (tables[table] || []).filter((r) => !match(r, m)); notify(table); toast(); },
    async command() { toast(); return { id: nextId++ }; },
    async runTask() { toast(); return { id: nextId++ }; },
    async fileUrl(path) { return path && path.startsWith('data:') ? path : null; },
    async fileText() { return '<p style="font:16px sans-serif;padding:20px">Demo preview</p>'; },
    async signOut() {},
  };
}
