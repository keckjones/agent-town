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
};
async function processCommands() {
  const { data } = await db.from('commands').select('*').eq('status', 'queued').order('created_at').limit(10);
  for (const c of data || []) {
    const { data: claimed } = await db.from('commands').update({ status: 'running' }).eq('id', c.id).eq('status', 'queued').select();
    if (!claimed?.length) continue;
    let result, status = 'done';
    try {
      if (c.kind === 'send_test_text') result = await sendTestText();
      else if (c.kind === 'check_integrations') { await checkIntegrations(); result = { ok: true }; }
      else if (c.kind === 'run_task') {
        const { agent, kind, input } = c.input || {};
        if (!RUNNABLE[agent]?.includes(kind)) throw new Error(`Not allowed from the dashboard: ${agent}/${kind}`);
        const t = await enqueue(agent, kind, input || {}, { priority: 2, createdBy: 'owner' });
        result = { task_id: t.id };
      } else throw new Error(`Unknown command ${c.kind}`);
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
  await db.from('agents').update({ status: 'idle', current_task: null }).neq('id', '_');
  await say('manager', 'Command center online.');

  const { count } = await db.from('tasks').select('*', { count: 'exact', head: true });
  if (!count) await firstJobs();

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
