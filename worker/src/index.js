// Agent Town worker: runs forever in the cloud (Railway/Render).
//  - pulls tasks from the queue and hands them to the right agent
//  - wakes the manager on a schedule
//  - carries out approved items from the approval inbox
import cron from 'node-cron';
import { config } from './config.js';
import { db, setAgent, say, getSettings, enqueue } from './lib/db.js';
import { BudgetExceeded } from './lib/claude.js';
import { closeBrowser } from './lib/browser.js';
import { registry, verbs } from './agents/index.js';
import { runApprovals } from './executor.js';
import { firstJobs } from './kickoff.js';
import { startServer } from './server.js';
import { checkIntegrations } from './lib/integrations.js';
import { digestTick, sendTestText, rollupAiCost } from './agents/finance.js';
import { refreshSmsStatuses } from './lib/sms.js';
import { sportsReady } from './config.js';
import { recordMilestone } from './agents/realestate.js';
import { shopifyReady } from './lib/shopify.js';
import { youtubeConnectUrl } from './lib/youtube.js';
import { askBoss } from './lib/boss.js';
import { gmailConnectUrl, refreshGmailState } from './lib/gmail.js';
import { logEvent } from './lib/workflows.js';

const CONCURRENCY = Number(process.env.CONCURRENCY || 2);
const MAX_ATTEMPTS = 3;
let running = 0;
let stopping = false;
let wasPaused = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const later = (minutes) => new Date(Date.now() + minutes * 60000).toISOString();

async function runTask(task) {
  const agent = registry[task.agent_id];
  const handler = agent?.[task.kind];
  if (!handler) {
    await db.from('tasks').update({ status: 'failed', error: `Unknown task ${task.agent_id}/${task.kind}`, finished_at: new Date().toISOString() }).eq('id', task.id);
    return;
  }
  const label = verbs[task.kind] || task.kind;
  await setAgent(task.agent_id, { status: 'working', current_task: label });
  try {
    const limitMin = Number(process.env.TASK_TIMEOUT_MIN || 12);
    const result = await Promise.race([
      handler(task),
      new Promise((_, rej) => setTimeout(() => rej(new Error(`Timed out after ${limitMin} minutes`)), limitMin * 60000)),
    ]);
    await db.from('tasks').update({ status: 'done', result, finished_at: new Date().toISOString() }).eq('id', task.id);
    const { data: a } = await db.from('agents').select('xp, tasks_done').eq('id', task.agent_id).single();
    await setAgent(task.agent_id, { status: 'idle', current_task: null, xp: (a?.xp || 0) + 10, tasks_done: (a?.tasks_done || 0) + 1 });
  } catch (err) {
    const msg = err?.message || String(err);
    if (err instanceof BudgetExceeded) {
      // Put it back and try again in an hour (the budget resets at midnight).
      await db.from('tasks').update({ status: 'queued', run_after: later(60), attempts: task.attempts - 1, error: msg }).eq('id', task.id);
      await setAgent(task.agent_id, { status: 'waiting', current_task: 'Out of budget for today' });
      await say(task.agent_id, msg, 'warn');
      return;
    }
    const retry = task.attempts < MAX_ATTEMPTS;
    await db.from('tasks').update({
      status: retry ? 'queued' : 'failed', error: msg,
      run_after: retry ? later(5 * task.attempts) : undefined,
      finished_at: retry ? null : new Date().toISOString(),
    }).eq('id', task.id);
    await setAgent(task.agent_id, { status: retry ? 'idle' : 'error', current_task: null });
    await say(task.agent_id, `${retry ? 'Hit a snag, will retry' : 'Gave up'} on ${label.toLowerCase()}: ${msg.slice(0, 160)}`, retry ? 'warn' : 'error');
  }
}

async function pauseCheck() {
  const s = await getSettings();
  if (s.paused !== wasPaused) {
    wasPaused = s.paused;
    await db.from('agents').update({ status: s.paused ? 'paused' : 'idle', current_task: s.paused ? 'Paused by owner' : null }).neq('id', '_');
    console.log(s.paused ? 'Town is PAUSED' : 'Town is running');
  }
  return s.paused;
}

async function loop() {
  while (!stopping) {
    try {
      if (await pauseCheck()) { await sleep(5000); continue; }
      while (running < CONCURRENCY) {
        const { data, error } = await db.rpc('claim_next_task');
        if (error) throw new Error(error.message);
        const task = data?.[0];
        if (!task) break;
        running++;
        runTask(task).finally(() => { running--; });
      }
    } catch (e) {
      console.error('Loop error:', e.message);
    }
    await sleep(config.pollSeconds * 1000);
  }
}

// Run a background job on a schedule, never overlapping itself, skipped while paused, errors logged not thrown.
function every(expr, name, fn, { evenWhenPaused = false } = {}) {
  let busy = false;
  cron.schedule(expr, async () => {
    if (busy) return;
    busy = true;
    try {
      if (!evenWhenPaused && await getSettings().then((s) => s.paused).catch(() => true)) return;
      await fn();
    } catch (e) {
      console.error(`${name} error:`, e.message);
    } finally { busy = false; }
  }, { timezone: config.timezone });
}

const once = (agent, kind, input = {}, priority = 5) => async () => {
  const { data } = await db.from('tasks').select('id').eq('agent_id', agent).eq('kind', kind).in('status', ['queued', 'running']).limit(1);
  if (!data?.length) await enqueue(agent, kind, input, { priority, createdBy: 'schedule' });
};

// Requests from the dashboard (test text, refresh integrations, run a job now).
const RUNNABLE = {
  manager: ['plan'], scout: ['find_prospects'], research: ['research'], etsy: ['research_products'], opportunity: ['propose_opportunities'],
  sports: ['sync_picks', 'draft_content'], fulfillment: ['sync_orders'], support: ['process_inbox'], postmaster: ['run_followups', 'draft_email', 'draft_proposal'],
  designer: ['design_page'], caller: ['prepare_call', 'record_outcome'], marketer: ['plan_campaign'], merchant: ['build_digital_product'], qa: ['check_site'],
  ds_research: ['research_niches'], ds_store: ['build_listing'], ds_orders: ['review_order', 'sync_shopify_orders'],
  re_market: ['market_report'], re_leads: ['import_leads'], re_underwrite: ['underwrite'], re_deals: ['plan_outreach', 'prepare_offer'], re_buyers: ['match_buyers'],
  risk: ['check_risks'], capital: ['allocation_report'], learning: ['weekly_learning'], experiments: ['design_experiment'], improve: ['find_bottlenecks'],
  brand_dev: ['propose_brand'], strategy: ['plan_calendar'], scriptwriter: ['write_script'], creative: ['produce'], editor: ['edit'], content_qa: ['review'],
  publisher: ['publish_due'], growth: ['measure', 'evaluate_brands'], community: ['check_comments'], account_prov: ['check_accounts'],
};
// Retry a failed task: re-queue the same row once. External side effects stay duplicate-proof through runOnce keys.
async function retryTask(id) {
  const { data: t } = await db.from('tasks').select('*').eq('id', id).single();
  if (!t) throw new Error('Task not found');
  if (t.status !== 'failed') throw new Error(`Task is ${t.status}, not failed`);
  const { data: open } = await db.from('tasks').select('id').eq('agent_id', t.agent_id).eq('kind', t.kind).in('status', ['queued', 'running']).contains('input', t.input || {}).limit(1);
  if (open?.length) return { already_queued: open[0].id };
  const { data: upd } = await db.from('tasks').update({ status: 'queued', attempts: 0, error: null, finished_at: null, run_after: new Date().toISOString(), created_by: 'owner_retry' }).eq('id', id).eq('status', 'failed').select('id');
  if (!upd?.length) return { already_retried: true };
  await setAgent(t.agent_id, { status: 'idle', current_task: null });
  await say(t.agent_id, `Retrying ${verbs[t.kind] || t.kind} (requested by owner).`);
  return { requeued: id };
}

// Reassign a workflow's owner to another agent in the same business. Logged as a handoff; permissions are unchanged
// because each agent can still only run its own task types.
async function reassignWorkflow(id, to) {
  const [{ data: wf }, { data: agent }] = await Promise.all([db.from('workflows').select('*').eq('id', id).single(), db.from('agents').select('id,division').eq('id', to).single()]);
  if (!wf) throw new Error('Workflow not found');
  if (!agent) throw new Error('Agent not found');
  if (agent.division !== wf.division) throw new Error('Can only reassign within the same business');
  if (wf.owner_agent === to) return { unchanged: true };
  await db.from('workflows').update({ owner_agent: to, updated_at: new Date().toISOString() }).eq('id', id);
  await logEvent(id, 'manager', 'handoff', `Reassigned by owner: ${wf.owner_agent || 'nobody'} → ${to}`, { from: wf.owner_agent, to, stage: wf.stage, by: 'owner' });
  return { from: wf.owner_agent, to };
}

async function processCommands() {
  const { data } = await db.from('commands').select('*').eq('status', 'queued').order('created_at').limit(10);
  for (const c of data || []) {
    const { data: claimed } = await db.from('commands').update({ status: 'running' }).eq('id', c.id).eq('status', 'queued').select();
    if (!claimed?.length) continue;
    let result, status = 'done';
    // One slow command (e.g. a connection check) must never hold up the others.
    const limit = new Promise((_, rej) => setTimeout(() => rej(new Error('Timed out after 90 seconds')), 90000));
    try {
      await Promise.race([limit, (async () => {
      if (c.kind === 'send_test_text') result = await sendTestText();
      else if (c.kind === 'check_integrations') { await checkIntegrations(); result = { ok: true }; }
      else if (c.kind === 'run_task') {
        const { agent, kind, input } = c.input || {};
        if (!RUNNABLE[agent]?.includes(kind)) throw new Error(`Not allowed from the dashboard: ${agent}/${kind}`);
        const t = await enqueue(agent, kind, input || {}, { priority: 2, createdBy: 'owner' });
        result = { task_id: t.id };
      } else if (c.kind === 're_milestone') result = await recordMilestone(c.input || {});
      else if (c.kind === 'retry_task') result = await retryTask(Number(c.input?.task_id));
      else if (c.kind === 'reassign_workflow') result = await reassignWorkflow(Number(c.input?.workflow_id), String(c.input?.to || ''));
      else if (c.kind === 'ask_boss') result = await askBoss(c.input?.question);
      else if (c.kind === 'gmail_connect') result = { url: await gmailConnectUrl() };
      else if (c.kind === 'youtube_connect') result = { url: await youtubeConnectUrl(Number(c.input.account_id)) };
      else throw new Error(`Unknown command ${c.kind}`);
      })()]);
    } catch (e) { status = 'failed'; result = { error: e.message }; }
    await db.from('commands').update({ status, result, finished_at: new Date().toISOString() }).eq('id', c.id);
  }
}

async function main() {
  console.log('Agent Town worker starting...');
  startServer();

  const { error: v2 } = await db.from('workflows').select('id', { head: true, count: 'exact' });
  if (v2) {
    console.error('Command-center tables are missing. Run supabase/002_command_center.sql in the Supabase SQL Editor.');
    await say('manager', 'Setup needed: run 002_command_center.sql in Supabase, then redeploy.', 'error');
  }

  // Any task left "running" by a crash or redeploy goes back in the queue (external actions are duplicate-proof).
  await db.from('tasks').update({ status: 'queued' }).eq('status', 'running');
  // Harmless dashboard requests interrupted by a restart are picked up again (nothing that sends is in this list).
  await db.from('commands').update({ status: 'queued' }).eq('status', 'running').in('kind', ['gmail_connect', 'youtube_connect', 'check_integrations', 'ask_boss']);
  await db.from('agents').update({ status: 'idle', current_task: null }).neq('id', '_');
  await say('manager', 'Command center online.');

  const { count } = await db.from('tasks').select('*', { count: 'exact', head: true });
  if (!count) await firstJobs();

  await refreshGmailState().catch(() => {});
  checkIntegrations().catch((e) => console.error('Integration check:', e.message));

  every(config.managerCron, 'manager', once('manager', 'plan', {}, 1));
  every('* * * * *', 'approvals', runApprovals);
  every('* * * * *', 'commands', processCommands, { evenWhenPaused: true });
  every('* * * * *', 'digest', digestTick, { evenWhenPaused: true });          // the digest has its own pause switch
  every('*/2 * * * *', 'sms status', refreshSmsStatuses, { evenWhenPaused: true });
  every('*/5 * * * *', 'inbox', once('support', 'process_inbox', {}, 2));
  every('7 * * * *', 'follow-ups', once('postmaster', 'run_followups', {}, 4));
  every('*/30 * * * *', 'orders', once('fulfillment', 'sync_orders', {}, 3));
  every('12 * * * *', 'sports', async () => { if (sportsReady()) await once('sports', 'sync_picks', {}, 3)(); });
  every('*/30 * * * *', 'integrations', checkIntegrations, { evenWhenPaused: true });
  every('10 0 * * *', 'daily rollup', rollupAiCost, { evenWhenPaused: true });
  every('20 * * * *', 'risk', once('risk', 'check_risks', {}, 1), { evenWhenPaused: false });
  every('*/30 * * * *', 'shopify tracking', async () => { if (shopifyReady()) await once('ds_orders', 'sync_shopify_orders', {}, 3)(); });
  every('0 6 * * 1', 'weekly learning', once('learning', 'weekly_learning', {}, 6));
  every('15 6 * * 1', 'capital', once('capital', 'allocation_report', {}, 6));
  every('30 6 * * 1', 'bottlenecks', once('improve', 'find_bottlenecks', {}, 7));
  every('*/10 * * * *', 'publishing', once('publisher', 'publish_due', {}, 3));
  every('40 7 * * *', 'content metrics', once('growth', 'measure', {}, 6));
  every('25 * * * *', 'comments', once('community', 'check_comments', {}, 6));
  every('5 */6 * * *', 'accounts', once('account_prov', 'check_accounts', {}, 6));
  every('45 6 * * 1', 'brand evaluation', once('growth', 'evaluate_brands', {}, 6));

  // Keep the dashboard's "online" light green.
  setInterval(() => db.from('agents').update({ last_seen: new Date().toISOString() }).eq('id', 'manager').then(() => {}), 60000);

  loop();
}

async function shutdown() {
  stopping = true;
  console.log('Shutting down...');
  await closeBrowser();
  process.exit(0);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((e) => { console.error(e); process.exit(1); });
