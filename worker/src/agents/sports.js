// Sports Marketing for KJ's Picks. Reads the sports site's OFFICIAL picks ledger (read-only) and drafts compliant content.
// Rules: only official-ledger picks; never change or upgrade a pick; nothing when the model data is stale or fails its
// integrity check; every post shows the odds timestamp, 21+, and the responsible-gambling line; results include losses.
// Queued content is withdrawn automatically if the underlying pick changes.
import crypto from 'node:crypto';
import { config, sportsReady } from '../config.js';
import { db, must, say, requestApproval, getSettings, setIntegration } from '../lib/db.js';
import { askJSON } from '../lib/claude.js';
import { ensureWorkflow, advance } from '../lib/workflows.js';

let session = null;

async function sportsToken() {
  if (session && session.exp > Date.now()) return session.token;
  const res = await fetch(`${config.sports.supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: config.sports.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: config.sports.email, password: config.sports.password }), signal: AbortSignal.timeout(20000),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Sports site login failed: ${j.error_description || j.msg || res.status}`);
  session = { token: j.access_token, exp: Date.now() + (j.expires_in - 120) * 1000 };
  return session.token;
}

async function fetchSiteData() {
  const token = await sportsToken();
  const res = await fetch(`${config.sports.supabaseUrl}/storage/v1/object/private/site_data.json`, {
    headers: { apikey: config.sports.anonKey, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000),
  });
  if (!res.ok) throw new Error(`Could not read pick data (${res.status}). Is the marketing account an active member?`);
  const text = await res.text();
  return { data: JSON.parse(text), hash: crypto.createHash('sha1').update(text).digest('hex') };
}

const pickKey = (r) => r.id ? String(r.id) : [r.league, r.game_id, r.bet_type, r.player || '', r.pick].join(':');
const SETTLED = new Set(['WIN', 'LOSS', 'PUSH', 'VOID']);

export const handlers = {
  async sync_picks() {
    if (!sportsReady()) return { skipped: 'not connected' };
    const { data: D, hash } = await fetchSiteData();
    const meta = D.meta || {};
    const runAt = new Date(meta.model_run || meta.updated);
    const ageH = (Date.now() - runAt) / 36e5;
    const stale = !!meta.stale || ageH > 26;                       // same rule the sports site uses
    const off = D.official || { rows: [], stats: {}, integrity: { ok: false } };
    const integrityOk = off.integrity?.ok !== false;
    await db.from('sports_snapshots').insert({ model_run: isNaN(runAt) ? null : runAt.toISOString(), stale: stale || !integrityOk,
      stale_reason: !integrityOk ? `Ledger integrity check failed: ${(off.integrity?.errors || []).join('; ')}` : (stale ? meta.stale_reason || `Model run is ${ageH.toFixed(0)}h old` : null),
      official_stats: off.stats, raw_hash: hash });

    const asOf = off.updated || meta.updated;
    const seen = new Set();
    let changed = 0;
    for (const r of off.rows || []) {
      const id = pickKey(r); seen.add(id);
      const { data: prev } = await db.from('sports_picks').select('*').eq('id', id).maybeSingle();
      const row = { id, league: r.league, game_id: String(r.game_id ?? ''), pick: r.pick, bet_type: r.bet_type, odds: r.odds != null ? String(r.odds) : null,
        line: r.line != null ? String(r.line) : null, kickoff: r.kickoff, status: r.status, data: r, odds_as_of: asOf, updated_at: new Date().toISOString() };
      await db.from('sports_picks').upsert(row);
      if (prev && (prev.status !== r.status || prev.odds !== row.odds || prev.line !== row.line || prev.pick !== row.pick)) {
        changed++;
        await withdrawFor(id, `Pick changed (${prev.status} ${prev.odds ?? ''} → ${r.status} ${row.odds ?? ''})`, SETTLED.has(r.status) && r.status !== 'VOID');
      }
    }
    // Picks that disappeared from the official ledger before kickoff: withdraw anything queued about them.
    const { data: open } = await db.from('sports_picks').select('id, kickoff, status').in('status', ['UPCOMING', 'LIVE']);
    for (const p of open || []) {
      if (!seen.has(p.id)) {
        await db.from('sports_picks').update({ status: 'WITHDRAWN', updated_at: new Date().toISOString() }).eq('id', p.id);
        await withdrawFor(p.id, 'Pick is no longer on the official ledger');
        changed++;
      }
    }
    await setIntegration('sports', "KJ's Picks data feed", 'connected', `Imported ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })}${stale ? ' — MODEL DATA STALE: no pick content will be drafted' : ''}`, null, 'sports');
    return { picks: (off.rows || []).length, changed, stale, integrityOk };
  },

  async draft_content(task) {
    const { data: snap } = await db.from('sports_snapshots').select('*').order('fetched_at', { ascending: false }).limit(1);
    if (!snap?.[0] || snap[0].stale) { await say('sports', 'Model data is stale or unverified; no pick content drafted.', 'warn'); return { skipped: 'stale' }; }
    const { data: chans } = await db.from('channels').select('*').eq('division', 'sports').eq('enabled', true).not('policy_verified_at', 'is', null);
    const organic = (chans || []).filter((c) => !c.requirements?.paid_ads);
    if (!organic.length) { await say('sports', 'No sports channel is enabled and policy-verified yet; nothing drafted.', 'warn'); return { skipped: 'no channels' }; }
    const settings = await getSettings();
    const rules = settings.sports_rules || {};
    const maxAge = Number(rules.max_odds_age_hours || 6);

    const { data: picks } = await db.from('sports_picks').select('*').eq('status', 'UPCOMING').gt('kickoff', new Date().toISOString());
    const fresh = (picks || []).filter((p) => (Date.now() - new Date(p.odds_as_of)) / 36e5 <= maxAge);
    const { data: done } = await db.from('content_items').select('source_refs').eq('division', 'sports').neq('status', 'withdrawn');
    const covered = new Set((done || []).flatMap((d) => (d.source_refs?.picks || []).map((x) => `${x.id}|${x.kind}`)));
    const todo = fresh.filter((p) => !covered.has(`${p.id}|pick`)).slice(0, 4);

    const { data: settled } = await db.from('sports_picks').select('*').in('status', ['WIN', 'LOSS', 'PUSH']).gte('updated_at', new Date(Date.now() - 2 * 864e5).toISOString());
    const recap = (settled || []).filter((p) => !covered.has(`${p.id}|result`));
    if (!todo.length && !recap.length) return { drafted: 0 };

    const stats = snap[0].official_stats?.ALL || {};
    const wf = await ensureWorkflow({ dedupeKey: `sports:week:${new Date().toISOString().slice(0, 10)}`, division: 'sports', kind: 'sports_campaign',
      objective: 'Promote KJ\'s Picks with accurate official picks and results', stage: 'drafting', owner: 'sports', nextAction: 'Owner approves posts' });
    let drafted = 0;
    for (const ch of organic) {
      const items = [...todo.map((p) => ({ kind: 'pick', p })), ...(recap.length ? [{ kind: 'result', p: null }] : [])];
      for (const it of items) {
        const ref = it.kind === 'pick' ? [{ id: it.p.id, kind: 'pick', status: it.p.status, odds: it.p.odds, line: it.p.line, odds_as_of: it.p.odds_as_of }]
          : recap.map((p) => ({ id: p.id, kind: 'result', status: p.status }));
        const utm = `${config.sports.siteUrl}${config.sports.siteUrl.includes('?') ? '&' : '?'}utm_source=${ch.id.replace('sports_', '')}&utm_medium=organic&utm_campaign=${it.kind === 'pick' ? `pick-${encodeURIComponent(it.p.id).slice(0, 40)}` : 'results'}`;
        const out = await askJSON({
          agentId: 'sports', cheap: true, maxTokens: 900,
          system: `You write ${ch.name} copy for KJ's Picks, a sports model subscription (Vegas-style, confident but honest).
Hard rules: never say "lock", "guaranteed", "can't lose", or promise profit. Never change the pick, line, or odds given. Never call anything official unless given as official.
Report results exactly as given, losses included. Always include the odds timestamp line given. No targeting of minors. Under 600 characters for social.`,
          prompt: it.kind === 'pick'
            ? `Official pick (from the ledger, do not alter): ${it.p.league} ${it.p.bet_type}: ${it.p.pick} ${it.p.odds ? `(${it.p.odds})` : ''}. Kickoff ${new Date(it.p.kickoff).toLocaleString('en-US', { timeZone: 'America/Chicago', weekday: 'short', hour: 'numeric', minute: '2-digit' })} CT.
Odds timestamp line: "Odds as of ${new Date(it.p.odds_as_of).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} CT; lines move."
Season official record: ${stats.record || 'n/a'} (${stats.units ?? 0} units). Link: ${utm}
Return JSON {"title": "...", "body": "post text including the odds line and link"}`
            : `Recent graded official picks: ${recap.map((p) => `${p.pick} ${p.odds || ''}: ${p.status}`).join('; ')}. Season official record ${stats.record} (${stats.units} units). Link: ${utm}
Write an honest results recap. Return JSON {"title": "...", "body": "..."}`,
        });
        const body = `${out.body.trim()}\n\n${rules.footer || '21+ | Gambling problem? Call 1-800-GAMBLER'}`;
        const { data: item } = await db.from('content_items').insert({ division: 'sports', channel: ch.id, kind: 'post', title: out.title, body,
          source_refs: { picks: ref }, status: 'pending_approval', utm }).select().single();
        await requestApproval({ agentId: 'sports', kind: 'content', division: 'sports', workflowId: wf.id,
          title: `${ch.name}: ${out.title}`.slice(0, 160), reason: it.kind === 'pick' ? 'New official pick on the ledger' : 'Official picks graded',
          evidence: ref, scope: `One organic post on ${ch.name}. Withdrawn automatically if the pick changes before it's posted.`,
          reversible: true, expiresInHours: it.kind === 'pick' ? Math.max(1, (new Date(it.p.kickoff) - Date.now()) / 36e5 - 0.5) : 48,
          payload: { content_id: item.id, channel: ch.id, body } });
        drafted++;
      }
    }
    await advance(wf.id, 'sports', { stage: 'approval', status: 'waiting_approval', note: `${drafted} posts drafted` });
    await say('sports', `${drafted} sports posts drafted for approval.`, 'success');
    return { drafted };
  },
};

async function withdrawFor(pickId, reason, settledNormally = false) {
  const { data: items } = await db.from('content_items').select('id, status, source_refs').eq('division', 'sports').in('status', ['draft', 'pending_approval', 'approved', 'scheduled']);
  for (const it of items || []) {
    const refs = it.source_refs?.picks || [];
    if (!refs.some((r) => r.id === pickId && r.kind === 'pick')) continue;
    // A pick that simply finished doesn't make an already-posted preview wrong, but unposted previews must not go out late.
    await db.from('content_items').update({ status: 'withdrawn', withdraw_reason: settledNormally ? 'Game started/finished before posting' : reason, updated_at: new Date().toISOString() }).eq('id', it.id);
    await db.from('approvals').update({ status: 'rejected', decision_note: `Withdrawn automatically: ${reason}` }).eq('kind', 'content').in('status', ['pending', 'approved']).contains('payload', { content_id: it.id });
  }
}
