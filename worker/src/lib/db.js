import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { config } from '../config.js';

export const db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
  // Node 20 has no built-in WebSocket; give Supabase the 'ws' package instead.
  realtime: { transport: ws },
});

export const BUCKET = 'town-files';

// Throw on Supabase errors so failures show up in the task log.
export function must({ data, error }) {
  if (error) throw new Error(error.message);
  return data;
}

export async function getSettings() {
  return must(await db.from('settings').select('*').eq('id', 1).single());
}

export async function setAgent(id, fields) {
  await db.from('agents').update({ ...fields, last_seen: new Date().toISOString() }).eq('id', id);
}

export async function say(agentId, message, level = 'info', data = null) {
  console.log(`[${agentId}] ${message}`);
  await db.from('events').insert({ agent_id: agentId, message, level, data });
  await db.from('agents').update({ speech: message.slice(0, 140), last_seen: new Date().toISOString() }).eq('id', agentId);
}

export async function enqueue(agentId, kind, input = {}, opts = {}) {
  const row = {
    agent_id: agentId,
    kind,
    input,
    priority: opts.priority ?? 5,
    created_by: opts.createdBy ?? 'manager',
    run_after: opts.runAfter ?? new Date().toISOString(),
  };
  return must(await db.from('tasks').insert(row).select().single());
}

// Upload a file (Buffer or string) to storage; returns the storage path.
export async function upload(path, body, contentType) {
  must(await db.storage.from(BUCKET).upload(path, body, { contentType, upsert: true }));
  return path;
}

export async function download(path) {
  const blob = must(await db.storage.from(BUCKET).download(path));
  return Buffer.from(await blob.arrayBuffer());
}

export async function signedUrl(path, seconds = 60 * 60 * 24 * 7) {
  const data = must(await db.storage.from(BUCKET).createSignedUrl(path, seconds));
  return data.signedUrl;
}

export async function addDocument(agentId, kind, title, body, data = null) {
  return must(await db.from('documents').insert({ agent_id: agentId, kind, title, body, data }).select().single());
}

/**
 * Ask the owner for a decision. Every card says what, why, evidence, cost, exposure, scope, and reversibility.
 * Set standing=true for a campaign / policy approval that authorizes many routine actions inside its limits.
 */
export async function requestApproval({
  agentId, kind, title, payload, preview = null, prospectId = null, workflowId = null, division = null,
  reason = null, evidence = null, costUsd = 0, maxExposureUsd = 0, expectedOutcome = null, uncertainty = null,
  scope = null, reversible = true, expiresInHours = null, standing = false,
}) {
  const row = must(await db.from('approvals').insert({
    agent_id: agentId, kind, title, payload, preview, prospect_id: prospectId, workflow_id: workflowId, division,
    reason, evidence, cost_usd: costUsd, max_exposure_usd: maxExposureUsd, expected_outcome: expectedOutcome,
    uncertainty, scope, reversible, standing,
    expires_at: expiresInHours ? new Date(Date.now() + expiresInHours * 3600e3).toISOString() : null,
  }).select().single());
  // A plain-English explanation for the owner (stored separately so a missing column never blocks the approval).
  const { explainApproval } = await import('./explain.js');
  await explainApproval(row);
  return row;
}

/** Record a money movement. external_id makes it idempotent (the same payment is never counted twice). */
export async function addLedger({ division, category, amountUsd, basis = 'actual', source, externalId = null, note = null, occurredOn = null }) {
  const row = { division, category, amount_usd: amountUsd, basis, source, external_id: externalId, note };
  if (occurredOn) row.occurred_on = occurredOn;
  const q = externalId ? db.from('ledger').upsert(row, { onConflict: 'external_id' }) : db.from('ledger').insert(row);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

/** Report whether an outside service is really connected. Shown on the dashboard as-is. */
export async function setIntegration(id, name, status, detail = null, setupSteps = null, division = null) {
  await db.from('integrations').upsert({ id, name, status, detail, setup_steps: setupSteps, division, checked_at: new Date().toISOString() });
}

// Count rows created since local midnight.
export async function countToday(table, filter = (q) => q) {
  const since = startOfToday();
  const { count, error } = await filter(db.from(table).select('*', { count: 'exact', head: true }).gte('created_at', since));
  if (error) throw new Error(error.message);
  return count || 0;
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}
