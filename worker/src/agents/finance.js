// Finance & Analytics: real numbers only. Every figure is labeled actual, estimated, or unavailable.
// Also owns the 7:30 AM morning text (one per day, guaranteed by the database).
import { config } from '../config.js';
import { db, say } from '../lib/db.js';
import { runOnce, AlreadyAttempted } from '../lib/actions.js';
import { sendSms } from '../lib/sms.js';
import { localDate, localMinutes, addDays, dayRange, nextLocalTime, fmtLocal } from '../lib/time.js';

const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(Number(n || 0)).toLocaleString('en-US', { maximumFractionDigits: 0 });
const sum = (rows, f = 'amount_usd') => (rows || []).reduce((s, r) => s + Number(r[f] || 0), 0);

async function count(table, apply) {
  const { count } = await apply(db.from(table).select('*', { count: 'exact', head: true }));
  return count || 0;
}

/** Collect yesterday's real figures (local day in the configured time zone). */
export async function metricsForDay(ymd, tz) {
  const [from, to] = dayRange(ymd, tz);
  const { data: led } = await db.from('ledger').select('category, amount_usd, basis, division').eq('occurred_on', ymd);
  const by = (cat, basis) => sum((led || []).filter((r) => r.category === cat && (!basis || r.basis === basis)));
  const { data: usage } = await db.from('usage').select('cost_usd').gte('created_at', from).lt('created_at', to);
  const ai = sum(usage, 'cost_usd');

  const revenue = by('revenue', 'actual');
  const refunds = by('refund', 'actual');
  const ads = by('ad_spend');
  const fulfillment = by('fulfillment');
  const fees = by('fees');
  const software = by('software');
  const profitEst = revenue - refunds - ads - fulfillment - fees - software - ai;

  const [newLeads, replies, closed, etsyOrders, etsyExceptions, approvals, blocked, failedTasks, intErrors] = await Promise.all([
    count('prospects', (q) => q.gte('created_at', from).lt('created_at', to)),
    count('messages', (q) => q.eq('direction', 'in').gte('created_at', from).lt('created_at', to)),
    count('prospects', (q) => q.eq('deal_stage', 'won').gte('updated_at', from).lt('updated_at', to)),
    count('orders', (q) => q.eq('platform', 'etsy').gte('created_at', from).lt('created_at', to)),
    count('orders', (q) => q.eq('status', 'exception')),
    count('approvals', (q) => q.eq('status', 'pending')),
    count('workflows', (q) => q.eq('status', 'blocked')),
    count('tasks', (q) => q.eq('status', 'failed').gte('finished_at', from).lt('finished_at', to)),
    count('integrations', (q) => q.eq('status', 'error')),
  ]);

  const { data: calls } = await db.from('call_tasks').select('outcome').gte('updated_at', from).lt('updated_at', to).not('outcome', 'is', null);
  const outcome = (o) => (calls || []).filter((c) => c.outcome === o).length;

  const { data: snap } = await db.from('sports_snapshots').select('official_stats, fetched_at, stale').order('fetched_at', { ascending: false }).limit(1);
  const { count: posted } = await db.from('content_items').select('*', { count: 'exact', head: true })
    .eq('division', 'sports').eq('status', 'published').gte('published_at', from).lt('published_at', to);
  const [dsOpen, dsExceptions, reDeadlines, reOffers, reContracts] = await Promise.all([
    count('orders', (q) => q.eq('division', 'dropship').in('status', ['new', 'validated', 'fulfilling'])),
    count('orders', (q) => q.eq('division', 'dropship').eq('status', 'exception')),
    count('deadlines', (q) => q.eq('status', 'open').lte('due_at', new Date(Date.now() + 72 * 3600e3).toISOString())),
    count('approvals', (q) => q.eq('status', 'pending').eq('kind', 're_offer')),
    count('re_deals', (q) => q.in('stage', ['under_contract', 'due_diligence', 'marketing', 'buyer_selected', 'assignment_signed', 'closing'])),
  ]);
  const [pubCount, pubFailed, videosInProd, brandsValidated] = await Promise.all([
    count('content_items', (q) => q.eq('division', 'media').in('stage', ['published', 'measured']).gte('published_at', from).lt('published_at', to)),
    count('content_items', (q) => q.eq('division', 'media').eq('stage', 'blocked')),
    count('content_items', (q) => q.eq('division', 'media').in('stage', ['script', 'creation', 'editing', 'review'])),
    count('brands', (q) => q.eq('status', 'validated').is('ceo_agent_id', null)),
  ]);
  const { data: viewRows } = await db.from('brand_metrics').select('views').eq('observed_on', ymd);
  const { data: dsLed } = await db.from('ledger').select('category, amount_usd, basis').eq('occurred_on', ymd).eq('division', 'dropship');
  const dsRev = sum((dsLed || []).filter((r) => r.category === 'revenue' && r.basis === 'actual'));
  const { data: opp } = await db.from('opportunities').select('title, scores').eq('status', 'proposed').order('created_at', { ascending: false }).limit(5);
  const best = (opp || []).sort((a, b) => (b.scores?.total || 0) - (a.scores?.total || 0))[0];

  return {
    ymd, revenue, refunds, ads, fulfillment, fees, software, ai, profitEst, hasLedger: (led || []).length > 0,
    newLeads, replies, closed, etsyOrders, etsyExceptions, approvals, blocked, failedTasks, intErrors, links: await linkDigest(),
    calls: { total: (calls || []).length, connected: (calls || []).filter((c) => !['no_answer', 'voicemail', 'wrong_number'].includes(c.outcome)).length,
      meetings: outcome('meeting_booked'), signed: outcome('agreement_signed'), qualified: outcome('interested') + outcome('proposal_requested') },
    sports: snap?.[0] ? { record: snap[0].official_stats?.ALL?.record, units: snap[0].official_stats?.ALL?.units, stale: snap[0].stale, posted: posted || 0 } : null,
    bestOpportunity: best?.title || null,
    dropship: { revenue: dsRev, open: dsOpen, exceptions: dsExceptions },
    media: { published: pubCount, blocked: pubFailed, inProduction: videosInProd, validated: brandsValidated, views: (viewRows || []).reduce((s, r) => s + Number(r.views || 0), 0) },
    realestate: { deadlines72h: reDeadlines, offersAwaiting: reOffers, activeContracts: reContracts },
  };
}

export function digestText(m, dashboardUrl) {
  const day = new Date(m.ymd + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const lines = [
    `KJ Agentic: ${day}`,
    `Revenue ${money(m.revenue)} (actual)${m.refunds ? `, refunds ${money(m.refunds)}` : ''}`,
    `Profit ~${money(m.profitEst)} (estimate)`,
    `Costs: ads ${money(m.ads)}, fulfillment ${money(m.fulfillment)}, AI ~${money(m.ai)}`,
    `Agency: ${m.newLeads} new leads, ${m.replies} replies, ${m.closed} closed`,
    m.calls.total ? `Calls: ${m.calls.connected} connected, ${m.calls.qualified} qualified, ${m.calls.meetings} meetings, ${m.calls.signed} signed` : null,
    `Etsy: ${m.etsyOrders} orders${m.etsyExceptions ? `, ${m.etsyExceptions} need attention` : ''}`,
    m.sports ? `Sports: official ${m.sports.record || 'n/a'}${m.sports.units != null ? ` (${m.sports.units > 0 ? '+' : ''}${m.sports.units}u)` : ''}, ${m.sports.posted} posts${m.sports.stale ? ', model data STALE' : ''}` : 'Sports: not connected',
    m.dropship && (m.dropship.revenue || m.dropship.open || m.dropship.exceptions) ? `Dropship: ${money(m.dropship.revenue)} collected, ${m.dropship.open} open orders${m.dropship.exceptions ? `, ${m.dropship.exceptions} EXCEPTIONS` : ''}` : null,
    m.realestate && (m.realestate.activeContracts || m.realestate.offersAwaiting || m.realestate.deadlines72h) ? `Real estate: ${m.realestate.activeContracts} under contract, ${m.realestate.offersAwaiting} offers need you${m.realestate.deadlines72h ? `, ${m.realestate.deadlines72h} DEADLINES within 72h` : ''}` : null,
    m.media && (m.media.published || m.media.blocked || m.media.inProduction) ? `Content: ${m.media.published} published, ${m.media.inProduction} in production${m.media.blocked ? `, ${m.media.blocked} BLOCKED` : ''}${m.media.views ? `, ${m.media.views.toLocaleString()} views (YouTube)` : ''}` : null,
    m.media?.validated ? `Brands meeting criteria: ${m.media.validated} (promotion needs your approval)` : null,
    m.bestOpportunity ? `Top idea: ${m.bestOpportunity}` : null,
    m.links?.newCount ? `New live: ${m.links.newCount} (${m.links.newest}). See Live Links.` : null,
    m.links?.views7 ? `Your pages: ${m.links.views7} views, ${m.links.clicks7} clicks (7d)` : null,
    `Needs you: ${m.approvals} approvals${m.blocked ? `, ${m.blocked} blocked` : ''}${m.failedTasks ? `, ${m.failedTasks} failed jobs` : ''}${m.intErrors ? `, ${m.intErrors} integration errors` : ''}`,
    dashboardUrl || null,
  ];
  return lines.filter(Boolean).join('\n');
}

async function settings() {
  const { data } = await db.from('notify_settings').select('*').eq('id', 1).maybeSingle();
  return data || { phone: '+19403661992', timezone: 'America/Chicago', digest_time: '07:30', digest_enabled: true, paused: false };
}

/** Called every minute. Sends today's digest once, at or after the configured local time. */
export async function digestTick() {
  const s = await settings();
  const tz = s.timezone || 'America/Chicago';
  const today = localDate(new Date(), tz);
  const [h, mm] = (s.digest_time || '07:30').split(':').map(Number);
  const due = h * 60 + mm;
  const nowMin = localMinutes(new Date(), tz);
  if (!s.digest_enabled || s.paused || nowMin < due) return;
  if (nowMin > due + 240) return; // more than 4 hours late (worker was down): skip rather than text at night

  const { data: existing } = await db.from('sms_messages').select('*').eq('kind', 'digest').eq('digest_date', today).maybeSingle();
  if (existing && (existing.provider_sid || existing.attempts >= 3 || ['sending', 'unknown'].includes(existing.status))) return;
  if (existing && existing.status === 'failed' && Date.now() - new Date(existing.updated_at) < 5 * 60000) return;

  const m = await metricsForDay(addDays(today, -1), tz);
  const body = digestText(m, s.dashboard_url || config.dashboardUrl);

  let row = existing;
  if (!row) {
    const { data: ins, error } = await db.from('sms_messages').insert({ kind: 'digest', digest_date: today, to_number: s.phone, body, status: 'sending', attempts: 1 }).select().single();
    if (error) return; // another worker created today's digest first (unique index)
    row = ins;
  } else {
    await db.from('sms_messages').update({ status: 'sending', attempts: row.attempts + 1, body, updated_at: new Date().toISOString() }).eq('id', row.id);
  }

  try {
    // One key per day: a refused send (nothing went out) may retry; an uncertain one never does.
    const { result, skipped } = await runOnce(`sms:digest:${today}`, 'sms', () => sendSms(s.phone, body));
    if (skipped) return;
    await db.from('sms_messages').update({ provider_sid: result.sid, status: result.status || 'sent', error: null, updated_at: new Date().toISOString() }).eq('id', row.id);
    await say('finance', 'Morning text sent.', 'success');
  } catch (e) {
    const status = e.retryable ? 'failed' : 'unknown';
    await db.from('sms_messages').update({ status, error: e.message.slice(0, 400), updated_at: new Date().toISOString() }).eq('id', row.id);
    if (!(e instanceof AlreadyAttempted)) await say('finance', `Morning text not sent: ${e.message.slice(0, 160)}`, 'error');
  }
}

export async function sendTestText() {
  const s = await settings();
  const tz = s.timezone || 'America/Chicago';
  const m = await metricsForDay(addDays(localDate(new Date(), tz), -1), tz);
  const body = `TEST from KJ Agentic. If you got this, the morning text works.\n\nPreview of tomorrow's format:\n${digestText(m, s.dashboard_url || config.dashboardUrl)}`;
  const { data: row } = await db.from('sms_messages').insert({ kind: 'test', to_number: s.phone, body, status: 'sending', attempts: 1 }).select().single();
  try {
    const r = await sendSms(s.phone, body);
    await db.from('sms_messages').update({ provider_sid: r.sid, status: r.status || 'sent', updated_at: new Date().toISOString() }).eq('id', row.id);
    await db.from('integrations').upsert({ id: 'twilio', name: 'Twilio SMS', division: 'finance', status: 'unverified',
      detail: 'Test text accepted by Twilio; waiting for the delivery receipt.', checked_at: new Date().toISOString() });
    return { sent: true, sid: r.sid };
  } catch (e) {
    await db.from('sms_messages').update({ status: 'failed', error: e.message.slice(0, 400), updated_at: new Date().toISOString() }).eq('id', row.id);
    throw e;
  }
}

export async function digestStatus() {
  const s = await settings();
  const tz = s.timezone || 'America/Chicago';
  const next = nextLocalTime(s.digest_time || '07:30', tz);
  return { next_send: next ? fmtLocal(next, tz) : null, enabled: s.digest_enabled && !s.paused };
}

/** Daily: record yesterday's AI cost in the ledger (measured from token usage; labeled estimated). */
export async function rollupAiCost() {
  const tz = config.timezone;
  const y = addDays(localDate(new Date(), tz), -1);
  const [from, to] = dayRange(y, tz);
  const { data } = await db.from('usage').select('cost_usd, agent_id').gte('created_at', from).lt('created_at', to);
  const total = sum(data, 'cost_usd');
  await db.from('ledger').upsert({ occurred_on: y, division: 'hq', category: 'ai', amount_usd: Number(total.toFixed(4)), basis: 'estimated',
    source: 'token usage × configured prices', external_id: `ai:${y}` }, { onConflict: 'external_id' });
}

export const handlers = {
  async send_test_text() { return sendTestText(); },
  async daily_rollup() { await rollupAiCost(); return { ok: true }; },
};


/** New live links in the last day and 7-day traffic on our own pages (for the morning text). */
async function linkDigest() {
  const since = new Date(Date.now() - 864e5).toISOString();
  const { data: fresh, error } = await db.from('published_links').select('title').gte('created_at', since).eq('status', 'live');
  if (error) return null;
  const { data: pages } = await db.from('published_links').select('metrics').eq('kind', 'page').eq('status', 'live');
  return { newCount: (fresh || []).length, newest: (fresh || [])[0]?.title?.slice(0, 40) || '',
    views7: (pages || []).reduce((s, p) => s + Number(p.metrics?.views_7d || 0), 0), clicks7: (pages || []).reduce((s, p) => s + Number(p.metrics?.clicks_7d || 0), 0) };
}
