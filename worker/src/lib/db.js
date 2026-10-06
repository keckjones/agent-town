import { createClient } from '@supabase/supabase-js';
import { config } from '../config.js';

export const db = createClient(config.supabaseUrl, config.supabaseServiceKey, {
  auth: { persistSession: false },
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

export async function requestApproval({ agentId, kind, title, payload, preview = null, prospectId = null }) {
  return must(await db.from('approvals').insert({
    agent_id: agentId, kind, title, payload, preview, prospect_id: prospectId,
  }).select().single());
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
