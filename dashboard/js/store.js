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
  tasks: { cols: 'id,agent_id,kind,status,error,created_at,finished_at,attempts', order: ['created_at', false], limit: 300 },
  commands: { order: ['created_at', false], limit: 50 },
};

export function createLiveStore(sb) {
  const tables = {};
  let notify = () => {}, onEvent = () => {};
  const timers = {};
  const missing = new Set();

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
  }
  const reload = (name) => { clearTimeout(timers[name]); timers[name] = setTimeout(async () => { await load(name); notify(name); }, 350); };
  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };

  return {
    demo: false, tables, missing,
    t: (n) => tables[n] || [],
    async init(onChange, onNewEvent) {
      notify = onChange; onEvent = onNewEvent;
      await Promise.all(Object.keys(TABLES).map(load));
      const ch = sb.channel('command-center');
      for (const name of Object.keys(TABLES)) {
        if (['usage', 'ledger'].includes(name)) continue;
        ch.on('postgres_changes', { event: '*', schema: 'public', table: name }, (p) => {
          if (name === 'events' && p.eventType === 'INSERT') { tables.events = [p.new, ...(tables.events || [])].slice(0, 150); onEvent(p.new); notify('events'); return; }
          if (name === 'agents' && p.new) { const i = tables.agents.findIndex((a) => a.id === p.new.id); if (i >= 0) tables.agents[i] = p.new; notify('agents'); return; }
          reload(name);
        });
      }
      ch.subscribe();
      setInterval(() => { reload('usage'); reload('ledger'); }, 60000);
    },
    reload,
    async update(table, match, patch) { let q = sb.from(table).update(patch); for (const [k, v] of Object.entries(match)) q = q.eq(k, v); must(await q); reload(table); },
    async insert(table, row) { const d = must(await sb.from(table).insert(row).select()); reload(table); return d?.[0]; },
    async upsert(table, row, onConflict) { must(await sb.from(table).upsert(row, onConflict ? { onConflict } : undefined)); reload(table); },
    async remove(table, match) { let q = sb.from(table).delete(); for (const [k, v] of Object.entries(match)) q = q.eq(k, v); must(await q); reload(table); },
    async command(kind, input = {}) { const row = must(await sb.from('commands').insert({ kind, input }).select())[0]; reload('commands'); return row; },
    async runTask(agent, kind, input = {}) { return this.command('run_task', { agent, kind, input }); },
    async fileUrl(path) { if (!path) return null; const { data } = await sb.storage.from('town-files').createSignedUrl(path, 3600); return data?.signedUrl || null; },
    async fileText(path) { const { data } = await sb.storage.from('town-files').download(path); return data ? data.text() : ''; },
    async signOut() { await sb.auth.signOut(); location.reload(); },
  };
}

// ---------------------------------------------------------------- DEMO (isolated, labeled)
export function createDemoStore(seed) {
  const tables = seed();
  let notify = () => {}, onEvent = () => {}, nextId = 100000;
  const toast = () => window.__toast?.('Demo mode: nothing was sent or saved.');
  const match = (row, m) => Object.entries(m).every(([k, v]) => row[k] === v);
  return {
    demo: true, tables, missing: new Set(),
    t: (n) => tables[n] || [],
    async init(onChange, onNewEvent) {
      notify = onChange; onEvent = onNewEvent;
      const lines = [
        ['scout', 'Found 6 new hair salon prospects in Bryan, TX.', 'success'], ['inspector', 'Sample Salon: site scored 41/100, lead score 72.', 'info'],
        ['qa', 'Preview passed QA (14 checks).', 'success'], ['ds_orders', 'Order #1043 approved for fulfillment (31% margin).', 'success'],
        ['risk', 'Due soon: option period for deal #3 (Thu 5:00 PM).', 'warn'], ['re_underwrite', 'Max offer $112,000 (medium confidence).', 'info'],
        ['etsy', '3 product concepts researched (1 rejected for IP risk).', 'success'], ['support', 'Sample Bakery replied (interested). Draft answer is in approvals.', 'success'],
      ];
      let i = 0;
      setInterval(() => {
        const [agent_id, message, level] = lines[i++ % lines.length];
        const ev = { id: nextId++, agent_id, message, level, created_at: new Date().toISOString() };
        tables.events.unshift(ev); tables.events.length = Math.min(150, tables.events.length);
        const a = tables.agents.find((x) => x.id === agent_id);
        if (a) { a.status = 'working'; a.current_task = 'Working (demo)'; setTimeout(() => { a.status = 'idle'; a.current_task = null; notify('agents'); }, 6000); }
        onEvent(ev); notify('events'); notify('agents');
      }, 5500);
    },
    reload: () => {},
    async update(table, m, patch) { for (const r of tables[table] || []) if (match(r, m)) Object.assign(r, patch); notify(table); toast(); },
    async insert(table, row) { const r = { id: nextId++, created_at: new Date().toISOString(), ...row }; (tables[table] ||= []).unshift(r); notify(table); toast(); return r; },
    async upsert(table, row) { return this.insert(table, row); },
    async remove(table, m) { tables[table] = (tables[table] || []).filter((r) => !match(r, m)); notify(table); toast(); },
    async command() { toast(); return { id: nextId++ }; },
    async runTask() { toast(); return { id: nextId++ }; },
    async fileUrl(path) { return path && path.startsWith('data:') ? path : null; },
    async fileText() { return '<p style="font:16px sans-serif;padding:20px">Demo preview</p>'; },
    async signOut() {},
  };
}
