// Standing approvals. You approve a campaign / supplier / fulfillment policy once, with exact limits;
// routine actions inside those limits then run automatically. Anything outside them needs a new approval.
import { db, must, startOfToday } from './db.js';

export class OutsideAuthority extends Error {}

export async function activeAuthorities(kind, division = null) {
  let q = db.from('authorities').select('*').eq('kind', kind).eq('status', 'active');
  if (division) q = q.eq('division', division);
  const rows = must(await q);
  const now = Date.now();
  const live = [];
  for (const a of rows) {
    if (a.ends_at && new Date(a.ends_at).getTime() < now) {
      await db.from('authorities').update({ status: 'expired', updated_at: new Date().toISOString() }).eq('id', a.id);
      continue;
    }
    // The approval it came from must still be approved with the same content.
    if (a.approval_id) {
      const { data: ap } = await db.from('approvals').select('status, approved_hash').eq('id', a.approval_id).maybeSingle();
      if (!ap || !['approved', 'executed'].includes(ap.status) || ap.approved_hash !== a.version_hash) {
        await db.from('authorities').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', a.id);
        continue;
      }
    }
    live.push(a);
  }
  return live;
}

/**
 * Check an action against an authority and reserve it (idempotent per actionKey).
 * Throws OutsideAuthority with a plain-language reason when it doesn't fit.
 */
export async function useAuthority(authority, { actionKey, amountUsd = 0, check = () => null }) {
  const reason = check(authority.rules || {});
  if (reason) throw new OutsideAuthority(reason);

  const { data: used } = await db.from('authority_usage').select('id').eq('action_key', actionKey).maybeSingle();
  if (used) return true; // already counted

  if (Number(authority.budget_usd) > 0 && Number(authority.spent_usd) + Number(amountUsd) > Number(authority.budget_usd)) {
    throw new OutsideAuthority(`Would exceed this approval's budget ($${authority.spent_usd} of $${authority.budget_usd} used).`);
  }
  if (authority.daily_limit) {
    const { count } = await db.from('authority_usage').select('*', { count: 'exact', head: true })
      .eq('authority_id', authority.id).gte('created_at', startOfToday());
    if ((count || 0) >= authority.daily_limit) throw new OutsideAuthority(`Daily limit of ${authority.daily_limit} reached for "${authority.title}".`);
  }
  const { error } = await db.from('authority_usage').insert({ authority_id: authority.id, action_key: actionKey, amount_usd: amountUsd });
  if (error && !/duplicate key|unique/i.test(error.message)) throw new Error(error.message);
  if (amountUsd) await db.from('authorities').update({ spent_usd: Number(authority.spent_usd) + Number(amountUsd), updated_at: new Date().toISOString() }).eq('id', authority.id);
  return true;
}

/** Turn an approved "standing" approval into an active authority (once). */
export async function createAuthorityFromApproval(ap) {
  const p = ap.payload || {};
  const { data: existing } = await db.from('authorities').select('*').eq('approval_id', ap.id).maybeSingle();
  if (existing) return existing;
  const days = Number(p.duration_days || 0);
  return must(await db.from('authorities').insert({
    kind: p.authority_kind, division: ap.division, title: p.title || ap.title, rules: p.rules || {},
    budget_usd: Number(p.budget_usd || 0), daily_limit: p.daily_limit ? Number(p.daily_limit) : null,
    ends_at: days ? new Date(Date.now() + days * 864e5).toISOString() : null,
    approval_id: ap.id, version_hash: ap.approved_hash,
  }).select().single());
}
