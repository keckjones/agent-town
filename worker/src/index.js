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
    const result = await handler(task);
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

async function main() {
  console.log('Agent Town worker starting...');
  // Any task left "running" by a crash or redeploy goes back in the queue.
  await db.from('tasks').update({ status: 'queued' }).eq('status', 'running');
  await db.from('agents').update({ status: 'idle', current_task: null }).neq('id', '_');
  await say('manager', 'Good morning, town! The worker is online.');

  // Very first start: give the town its first jobs.
  const { count } = await db.from('tasks').select('*', { count: 'exact', head: true });
  if (!count) await firstJobs();

  // Manager wakes up on a schedule.
  cron.schedule(config.managerCron, async () => {
    if (await getSettings().then((s) => s.paused).catch(() => true)) return;
    const { data } = await db.from('tasks').select('id').eq('agent_id', 'manager').in('status', ['queued', 'running']).limit(1);
    if (!data?.length) await enqueue('manager', 'plan', {}, { priority: 1, createdBy: 'schedule' });
  }, { timezone: config.timezone });

  // Carry out approved items every minute.
  cron.schedule('* * * * *', async () => {
    if (await getSettings().then((s) => s.paused).catch(() => true)) return;
    runApprovals().catch((e) => console.error('Approvals error:', e.message));
  });

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
