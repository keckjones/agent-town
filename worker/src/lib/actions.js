// Duplicate prevention for anything that touches the outside world (emails, texts, orders, listings, payments).
// Every side effect gets a stable key. The key is claimed in the database BEFORE the action runs, so a retry,
// a crash, or two workers can never perform the same action twice.
import { db } from './db.js';

export class AlreadyAttempted extends Error {}

/**
 * Run fn() at most once for this key.
 * - done before      → returns the stored result, does nothing
 * - started/unknown  → throws AlreadyAttempted (a previous attempt may have reached the provider; needs a human look)
 * - failed before    → allowed to retry only if the failure was recorded as safe to retry
 */
export async function runOnce(key, kind, fn, { workflowId = null, request = null } = {}) {
  const { data: existing } = await db.from('actions').select('*').eq('key', key).maybeSingle();
  if (existing) {
    if (existing.status === 'done') return { skipped: true, result: existing.result };
    if (existing.status === 'failed' && existing.result?.retryable) {
      const { data: reclaimed } = await db.from('actions')
        .update({ status: 'started', error: null, updated_at: new Date().toISOString() })
        .eq('key', key).eq('status', 'failed').select();
      if (!reclaimed?.length) throw new AlreadyAttempted(`Another worker is already handling ${key}`);
    } else {
      throw new AlreadyAttempted(`Action ${key} was already attempted (status: ${existing.status}). Not repeating it automatically.`);
    }
  } else {
    const { error } = await db.from('actions').insert({ key, kind, status: 'started', workflow_id: workflowId, request });
    if (error) {
      if (/duplicate key|unique/i.test(error.message)) throw new AlreadyAttempted(`Action ${key} is already in progress.`);
      throw new Error(error.message);
    }
  }

  try {
    const result = await fn();
    await db.from('actions').update({ status: 'done', result: result ?? {}, updated_at: new Date().toISOString() }).eq('key', key);
    return { skipped: false, result };
  } catch (err) {
    // If the provider clearly rejected the request (it never went out), it is safe to retry later.
    const retryable = !!err.retryable;
    await db.from('actions').update({
      status: retryable ? 'failed' : 'unknown', error: String(err.message || err).slice(0, 500),
      result: { retryable }, updated_at: new Date().toISOString(),
    }).eq('key', key);
    throw err;
  }
}

/** Mark an error as "the request definitely did not go through", so runOnce may retry it. */
export function retryable(err) { err.retryable = true; return err; }
