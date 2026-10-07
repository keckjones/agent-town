// "Talk to the Big Boss": the Executive Orchestrator (agent id `manager`) answers the owner's questions
// from real records only, and may PROPOSE actions. It never executes anything itself: every proposed action is
// shown as a button in the dashboard and goes through the same controls (approvals, run_task whitelist, pauses).
import { db, startOfToday } from './db.js';
import { askJSON } from './claude.js';

// Actions the Big Boss may propose. The dashboard maps each to an existing control; the worker re-validates run_task.
export const PROPOSABLE = ['run_task', 'open', 'pause_workflow', 'pause_business', 'retry_task'];

const ago = (iso) => (iso ? `${Math.round((Date.now() - new Date(iso)) / 60000)} min ago` : null);

/** A compact, factual snapshot with record references the answer must cite. */
export async function bossSnapshot() {
  const since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const day7 = since7.slice(0, 10);
  const q = async (p) => { try { return (await p).data || []; } catch { return []; } };
  const [agents, approvals, workflows, failed, queued, ledger, deadlines, orders, divisions, events, usage] = await Promise.all([
    q(db.from('agents').select('id,name,division,status,current_task,enabled')),
    q(db.from('approvals').select('id,title,kind,division,agent_id,created_at,max_exposure_usd,expires_at').eq('status', 'pending').order('created_at').limit(25)),
    q(db.from('workflows').select('id,division,objective,stage,status,owner_agent,next_action,next_action_at,blockers,updated_at').in('status', ['active', 'waiting_approval', 'blocked', 'paused']).order('updated_at', { ascending: false }).limit(60)),
    q(db.from('tasks').select('id,agent_id,kind,error,finished_at').eq('status', 'failed').gte('finished_at', new Date(Date.now() - 864e5).toISOString()).limit(15)),
    q(db.from('tasks').select('id,agent_id,kind,status,run_after').in('status', ['queued', 'running']).limit(60)),
    q(db.from('ledger').select('division,category,basis,amount_usd').gte('occurred_on', day7)),
    q(db.from('deadlines').select('id,subject_type,subject_id,kind,due_at,status').eq('status', 'open').order('due_at').limit(10)),
    q(db.from('orders').select('id,division,external_id,status,created_at').in('status', ['new', 'validated', 'fulfilling', 'exception']).limit(30)),
    q(db.from('divisions').select('id,name,status')),
    q(db.from('events').select('id,agent_id,level,message,created_at').order('created_at', { ascending: false }).limit(25)),
    q(db.from('usage').select('cost_usd').gte('created_at', startOfToday())),
  ]);
  const money = {};
  for (const r of ledger) {
    const k = `${r.division || 'other'}`;
    money[k] ||= { collected_actual: 0, refunds: 0, costs: 0 };
    if (r.category === 'revenue' && r.basis === 'actual') money[k].collected_actual += Number(r.amount_usd);
    else if (r.category === 'refund') money[k].refunds += Number(r.amount_usd);
    else if (r.category !== 'revenue' && r.category !== 'commitment') money[k].costs += Number(r.amount_usd);
  }
  return {
    now: new Date().toISOString(),
    businesses: divisions.map((d) => ({ id: d.id, name: d.name, paused: d.status === 'paused' })),
    agents_working: agents.filter((a) => a.status === 'working').map((a) => ({ ref: `agent:${a.id}`, name: a.name, task: a.current_task })),
    agents_failed_or_paused: agents.filter((a) => a.status === 'error' || !a.enabled).map((a) => ({ ref: `agent:${a.id}`, name: a.name, status: a.enabled ? a.status : 'paused' })),
    pending_approvals: approvals.map((a) => ({ ref: `approval:${a.id}`, title: a.title, business: a.division, waiting: ago(a.created_at), max_exposure_usd: Number(a.max_exposure_usd || 0) })),
    blocked_workflows: workflows.filter((w) => w.status === 'blocked').map((w) => ({ ref: `workflow:${w.id}`, objective: w.objective, blocker: w.blockers, business: w.division })),
    open_workflows: workflows.filter((w) => w.status !== 'blocked').slice(0, 30).map((w) => ({ ref: `workflow:${w.id}`, objective: w.objective, stage: w.stage, status: w.status, owner: w.owner_agent, next: w.next_action, last_update: ago(w.updated_at) })),
    failed_tasks_24h: failed.map((t) => ({ ref: `task:${t.id}`, agent: t.agent_id, kind: t.kind, error: (t.error || '').slice(0, 160) })),
    queue: queued.map((t) => ({ agent: t.agent_id, kind: t.kind, status: t.status, runs: t.run_after })),
    money_last_7_days_by_business: money,
    ai_spend_today_usd: Number(usage.reduce((s, r) => s + Number(r.cost_usd || 0), 0).toFixed(2)),
    real_estate_deadlines: deadlines.map((d) => ({ ref: `deadline:${d.id}`, subject: `${d.subject_type}:${d.subject_id}`, kind: d.kind, due: d.due_at })),
    open_orders: orders.map((o) => ({ ref: `order:${o.id}`, business: o.division, id: o.external_id, status: o.status })),
    recent_events: events.map((e) => ({ ref: `event:${e.id}`, agent: e.agent_id, level: e.level, message: e.message.slice(0, 160), when: ago(e.created_at) })),
  };
}

const SYSTEM = `You are the Executive Orchestrator ("Big Boss") of KJ Agentic, answering the owner, Keck.
Rules:
- Answer ONLY from the JSON snapshot provided. If the snapshot doesn't contain the answer, say so plainly.
- Cite the records you rely on using their "ref" values, e.g. [approval:12]. Never invent numbers, records, activity or outcomes.
- Collected revenue is only "collected_actual". Never call pipeline, estimates or forecasts revenue.
- You cannot approve, spend, override budgets, change permissions, or contact anyone. You may only PROPOSE actions; the owner decides.
- Keep it short and plain: 2–6 sentences or a short list. The owner is new to business: use everyday words and explain any jargon in parentheses the first time.
Allowed proposed actions (max 3):
  {"type":"open","ref":"approval:12","label":"..."}
  {"type":"run_task","agent":"<agent id>","kind":"<task kind>","input":{},"label":"..."}  (only the dashboard's allowed jobs)
  {"type":"retry_task","ref":"task:7","label":"..."}
  {"type":"pause_workflow","ref":"workflow:3","label":"..."}
  {"type":"pause_business","business":"<division id>","label":"..."}
Return JSON: {"answer": "...", "refs": ["approval:12", ...], "actions": [...]}`;

export async function askBoss(question) {
  const q = String(question || '').trim().slice(0, 800);
  if (!q) throw new Error('Ask a question.');
  const snap = await bossSnapshot();
  const r = await askJSON({ agentId: 'manager', cheap: true, maxTokens: 900, system: SYSTEM,
    prompt: `Snapshot:\n${JSON.stringify(snap)}\n\nOwner's question: ${q}` });
  const valid = new Set();
  for (const k of ['pending_approvals', 'blocked_workflows', 'open_workflows', 'failed_tasks_24h', 'real_estate_deadlines', 'open_orders', 'recent_events', 'agents_working', 'agents_failed_or_paused']) for (const x of snap[k] || []) valid.add(x.ref);
  // Drop any reference or action that doesn't point at a real record in the snapshot.
  const refs = (r.refs || []).filter((x) => valid.has(x));
  const actions = (r.actions || []).filter((a) => PROPOSABLE.includes(a.type) && (!a.ref || valid.has(a.ref))).slice(0, 3);
  return { answer: String(r.answer || '').slice(0, 2000), refs, actions, as_of: snap.now };
}
