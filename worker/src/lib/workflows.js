// Durable workflows with a full audit trail. Every stage change, action, cost, and error is recorded,
// so the dashboard can always show: objective, stage, owner, evidence, results, next action, cost, blockers.
import { db, must } from './db.js';

const now = () => new Date().toISOString();

/** Create a workflow once per dedupeKey (returns the existing one if it already exists). */
export async function ensureWorkflow({ dedupeKey, division, kind, objective, stage, owner, subjectType, subjectId, budgetUsd = 0, nextAction = null, data = {} }) {
  if (dedupeKey) {
    const { data: found } = await db.from('workflows').select('*').eq('dedupe_key', dedupeKey).maybeSingle();
    if (found) return found;
  }
  const { data: created, error } = await db.from('workflows').insert({
    dedupe_key: dedupeKey, division, kind, objective, stage, owner_agent: owner,
    subject_type: subjectType, subject_id: subjectId, budget_usd: budgetUsd, next_action: nextAction, data,
  }).select().single();
  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      return must(await db.from('workflows').select('*').eq('dedupe_key', dedupeKey).single());
    }
    throw new Error(error.message);
  }
  await logEvent(created.id, owner, 'stage', `Started: ${objective} (stage: ${stage})`);
  return created;
}

export async function getWorkflow(id) {
  return must(await db.from('workflows').select('*').eq('id', id).single());
}

export async function findWorkflow(subjectType, subjectId, kind) {
  const { data } = await db.from('workflows').select('*').eq('subject_type', subjectType).eq('subject_id', subjectId).eq('kind', kind).maybeSingle();
  return data;
}

export async function logEvent(workflowId, agentId, type, message, data = null, costUsd = 0) {
  if (!workflowId) return;
  await db.from('workflow_events').insert({ workflow_id: workflowId, agent_id: agentId, type, message: message.slice(0, 1000), data, cost_usd: costUsd });
}

/** Move to a new stage and/or update fields; logs the change. */
export async function advance(workflowId, agentId, { stage, status, nextAction, nextActionAt, blockers, recovery, owner, evidence, data, note } = {}) {
  if (!workflowId) return;
  const wf = await getWorkflow(workflowId);
  const patch = { updated_at: now() };
  if (stage !== undefined) patch.stage = stage;
  if (status !== undefined) patch.status = status;
  if (nextAction !== undefined) patch.next_action = nextAction;
  if (nextActionAt !== undefined) patch.next_action_at = nextActionAt;
  if (blockers !== undefined) patch.blockers = blockers;
  if (recovery !== undefined) patch.recovery = recovery;
  if (owner !== undefined) patch.owner_agent = owner;
  if (evidence) patch.evidence = [...(wf.evidence || []), ...evidence];
  if (data) patch.data = { ...(wf.data || {}), ...data };
  await db.from('workflows').update(patch).eq('id', workflowId);
  // Explicit handoff record: the trading floor draws a line between these two desks only from rows like this.
  if (owner !== undefined && owner && wf.owner_agent && owner !== wf.owner_agent) {
    await logEvent(workflowId, agentId, 'handoff', `${wf.stage}${stage && stage !== wf.stage ? ` → ${stage}` : ''}: handed to ${owner}`, { from: wf.owner_agent, to: owner, stage: stage || wf.stage });
  }
  if (stage && stage !== wf.stage) await logEvent(workflowId, agentId, 'stage', `Stage: ${wf.stage} → ${stage}${note ? ` (${note})` : ''}`);
  else if (note) await logEvent(workflowId, agentId, 'note', note);
  if (blockers) await logEvent(workflowId, agentId, 'error', `Blocked: ${blockers}`);
}

/** Add cost to a workflow and refuse if it would exceed its budget (when a budget is set). */
export async function addCost(workflowId, agentId, usd, what) {
  if (!workflowId || !usd) return;
  const wf = await getWorkflow(workflowId);
  const total = Number(wf.cost_usd) + Number(usd);
  await db.from('workflows').update({ cost_usd: total, updated_at: now() }).eq('id', workflowId);
  await logEvent(workflowId, agentId, 'cost', `${what}: $${Number(usd).toFixed(3)}`, null, usd);
}

export async function overBudget(workflowId) {
  if (!workflowId) return false;
  const wf = await getWorkflow(workflowId);
  return Number(wf.budget_usd) > 0 && Number(wf.cost_usd) >= Number(wf.budget_usd);
}
