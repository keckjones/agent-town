// How the agents work together.
// Any agent (or you, through the Big Boss) can ask for something it can't do itself: a website, a brand, social posts,
// research, a product, a campaign. Each request is routed to the one agent that can do it, tracked to completion, and
// shown on the floor as a handoff. Anything public or costly still goes through your approvals at the end.
import { db, say, enqueue, getSettings, requestApproval, startOfToday } from './db.js';
import { logEvent, ensureWorkflow, advance } from './workflows.js';

// What the team can do for each other. `input` builds the task input for the agent that fulfils it.
export const CAPABILITIES = {
  landing_page:       { agent: 'designer',    kind: 'build_site',            label: 'a landing page / website', input: (r) => ({}) },
  social_brand:       { agent: 'brand_dev',   kind: 'propose_brand',         label: 'a social media brand (name, look, accounts plan)', input: (r) => ({ focus: r.brief.niche || r.brief.topic || r.title }) },
  social_content:     { agent: 'social',      kind: 'write_posts',           label: 'social media posts', input: (r) => ({ theme: r.brief.topic || r.title, campaign: r.brief.campaign || r.title, count: Math.min(Number(r.brief.count) || 3, 6) }) },
  brand_calendar:     { agent: 'strategy',    kind: 'plan_calendar',         label: 'a content calendar for an existing brand', input: (r) => ({ brand_id: Number(r.brief.brand_id) }) },
  marketing_campaign: { agent: 'marketer',    kind: 'plan_campaign',         label: 'a marketing campaign plan', input: (r) => ({ focus: r.brief.goal || r.title }) },
  research:           { agent: 'research',    kind: 'research',              label: 'market research with sources', input: (r) => ({ topic: r.brief.question || r.title }) },
  etsy_product:       { agent: 'etsy',        kind: 'research_products',     label: 'Etsy product ideas', input: (r) => ({ focus: r.brief.focus || r.title }) },
  store_product:      { agent: 'ds_research', kind: 'research_niches',       label: 'products for the online store', input: (r) => ({ focus: r.brief.focus || r.title }) },
  local_leads:        { agent: 'scout',       kind: 'find_prospects',        label: 'a list of local businesses to contact', input: (r) => ({ category: r.brief.category || r.title, city: r.brief.city || undefined, limit: Math.min(Number(r.brief.limit) || 10, 20) }) },
  experiment_design:  { agent: 'experiments', kind: 'design_experiment',     label: 'a small, cheap test with a goal and stop rule', input: (r) => ({ division: r.division || 'ventures', idea: r.brief.idea || r.title, max_budget: Math.min(Number(r.brief.max_budget) || 50, 200) }) },
};
export const NEEDS = Object.keys(CAPABILITIES);
export const capabilityList = () => NEEDS.map((n) => `- "${n}": ${CAPABILITIES[n].label} (done by ${CAPABILITIES[n].agent})`).join('\n');

const now = () => new Date().toISOString();

/** Ask another agent for something. Duplicate-safe via dedupeKey. Returns the request row (existing or new). */
export async function requestWork({ fromAgent, need, title, brief = {}, division = null, workflowId = null, projectId = null, dependsOn = null, dedupeKey = null }) {
  const key = dedupeKey || `${fromAgent}:${need}:${String(title).toLowerCase().replace(/\W+/g, '-').slice(0, 80)}`;
  const { data: existing } = await db.from('work_requests').select('*').eq('dedupe_key', key).maybeSingle();
  if (existing) return existing;
  const cap = CAPABILITIES[need];
  const row = { from_agent: fromAgent, need, title: String(title).slice(0, 200), brief, division, workflow_id: workflowId, project_id: projectId, depends_on: dependsOn,
    dedupe_key: key, status: cap ? 'open' : 'blocked', assigned_agent: cap?.agent || null,
    result: cap ? null : { error: `No agent on the team can do "${need}" yet. Tell me (the developer) if you want this capability added.` } };
  const { data, error } = await db.from('work_requests').insert(row).select().single();
  if (error) { if (/duplicate|unique/i.test(error.message)) return (await db.from('work_requests').select('*').eq('dedupe_key', key).single()).data; throw new Error(error.message); }
  await logEvent(workflowId, fromAgent, 'note', `Asked ${cap?.agent || 'the team'} for ${cap?.label || need}: ${row.title}`);
  return data;
}

/** Start open requests (respecting dependencies, pauses and the daily cap). Runs every minute. */
export async function routeWork() {
  const { data: open, error } = await db.from('work_requests').select('*').eq('status', 'open').order('created_at').limit(20);
  if (error) return;   // migration 007 not run yet
  if (!open?.length) return;
  const settings = await getSettings();
  const cap = Number(settings.daily_request_cap ?? 12);
  const { count: startedToday } = await db.from('work_requests').select('id', { count: 'exact', head: true }).gte('updated_at', startOfToday()).in('status', ['queued', 'in_progress', 'done']);
  let budget = Math.max(0, cap - (startedToday || 0));
  for (const r of open) {
    if (r.depends_on) {
      const { data: dep } = await db.from('work_requests').select('status').eq('id', r.depends_on).maybeSingle();
      if (dep && dep.status !== 'done') { if (['blocked', 'rejected'].includes(dep.status)) await db.from('work_requests').update({ status: 'blocked', result: { error: 'An earlier step it depends on did not finish.' }, updated_at: now() }).eq('id', r.id); continue; }
    }
    if (budget <= 0) { if (!r.result?.waiting) await db.from('work_requests').update({ result: { waiting: `Daily limit of ${cap} team requests reached (keeps AI costs predictable). Starts tomorrow, or raise the limit in Finance.` } }).eq('id', r.id); continue; }
    const c = CAPABILITIES[r.need];
    const input = { ...c.input(r), work_request_id: r.id, reason: `Request from ${r.from_agent}: ${r.title}` };
    if (r.need === 'brand_calendar' && !input.brand_id) { await db.from('work_requests').update({ status: 'blocked', result: { error: 'Needs an existing brand id.' }, updated_at: now() }).eq('id', r.id); continue; }
    const { data: claimed } = await db.from('work_requests').update({ status: 'queued', updated_at: now() }).eq('id', r.id).eq('status', 'open').select();
    if (!claimed?.length) continue;
    // Work for your own ideas/requests goes in the express lane.
    const t = await enqueue(c.agent, c.kind, input, { createdBy: r.from_agent || 'manager', priority: r.project_id || r.from_agent === 'owner' ? 2 : 4 });
    await db.from('work_requests').update({ task_id: t.id, assigned_agent: c.agent }).eq('id', r.id);
    // A real handoff record: the floor draws a line and the requester walks the brief over.
    if (r.workflow_id && r.from_agent && r.from_agent !== c.agent) {
      await logEvent(r.workflow_id, r.from_agent, 'handoff', `request → ${r.need}: handed to ${c.agent}`, { from: r.from_agent, to: c.agent, stage: r.need, request_id: r.id });
    }
    await say(c.agent, `Picked up a request from ${r.from_agent}: ${r.title}`);
    budget--;
  }
}

/** Called by the task runner when a task that fulfils a request starts / finishes. */
export async function onRequestTask(task, phase, result = null, error = null) {
  const id = task?.input?.work_request_id;
  if (!id) return;
  if (phase === 'start') { await db.from('work_requests').update({ status: 'in_progress', updated_at: now() }).eq('id', id).in('status', ['queued', 'open']); return; }
  if (phase === 'failed') { await db.from('work_requests').update({ status: 'blocked', result: { error: String(error || 'failed').slice(0, 300) }, updated_at: now() }).eq('id', id); return; }
  // done: a handler may have already set a richer result (e.g. a site waiting for publish approval)
  const { data: r } = await db.from('work_requests').select('*').eq('id', id).maybeSingle();
  if (!r || ['done', 'waiting_approval'].includes(r.status)) return finishProject(r?.project_id);
  const out = outputRef(result);
  await db.from('work_requests').update({ status: 'done', result: { ...(r.result || {}), summary: summarize(result) }, output_ref: out, updated_at: now() }).eq('id', id);
  if (r.workflow_id) await logEvent(r.workflow_id, r.assigned_agent, 'result', `Done: ${r.title}${out ? ` (${out})` : ''}`);
  await finishProject(r.project_id);
}

function outputRef(res) {
  if (!res || typeof res !== 'object') return null;
  if (res.document_id) return `document:${res.document_id}`;
  if (res.experiment_id) return `experiment:${res.experiment_id}`;
  if (res.brand_id) return `brand:${res.brand_id}`;
  if (res.site_id) return `site:${res.site_id}`;
  return null;
}
const summarize = (res) => (res == null ? 'Done' : typeof res === 'object' ? JSON.stringify(res).slice(0, 300) : String(res).slice(0, 300));

/** When every step of a project is done (or stopped), close it out. */
export async function finishProject(projectId) {
  if (!projectId) return;
  const { data: reqs } = await db.from('work_requests').select('status').eq('project_id', projectId);
  if (!reqs?.length) return;
  const openish = reqs.some((r) => ['open', 'queued', 'in_progress', 'waiting_approval'].includes(r.status));
  if (openish) return;
  const { data: p } = await db.from('team_projects').select('*').eq('id', projectId).single();
  if (!p || p.status === 'done') return;
  const blocked = reqs.filter((r) => ['blocked', 'rejected'].includes(r.status)).length;
  await db.from('team_projects').update({ status: 'done', updated_at: now() }).eq('id', projectId);
  await advance(p.workflow_id, 'manager', { stage: 'done', status: 'done', nextAction: null, note: `All steps finished${blocked ? ` (${blocked} could not be completed)` : ''}.` });
  await say('manager', `Project finished: ${p.title}${blocked ? ` (${blocked} step(s) need your attention)` : ''}.`, blocked ? 'warn' : 'success');
}

// ---------------------------------------------------------------- the Big Boss turns an idea into a plan
const PLAN_SYSTEM = (caps) => `You are the Executive Orchestrator ("Big Boss") of KJ Agentic, a one-person company run with AI agents.
The owner gives you an idea. Turn it into a short plan made ONLY of steps your team can actually do:
${caps}
Rules:
- 1 to 6 steps, in a sensible order. Use "after" (a step number) when a step needs an earlier one's output (e.g. posts after the brand exists).
- Do not invent capabilities, prices, results or facts. If part of the idea needs something the team can't do (e.g. buying ads, hiring, legal work), list it under "owner_tasks".
- Nothing public happens without the owner's approval anyway (websites go live, posts, emails each need approval), so say so plainly.
- The owner is new to business: write "plain_english" for a beginner (what will happen, what it costs roughly in AI time, what they'll need to approve).
Return JSON: {"title": "short project name", "goal": "one sentence", "plain_english": "3-6 sentences",
 "steps": [{"n": 1, "need": "<one of the capability names>", "title": "what exactly", "brief": {"topic": "...", "audience": "...", "offer": "...", "call_to_action": "...", "niche": "...", "question": "...", "category": "...", "city": "...", "goal": "..."}, "why": "...", "after": null}],
 "owner_tasks": ["..."], "risks": ["..."]}`;

/** manager task: plan an idea, then ask the owner to approve the plan (one approval covers starting the steps). */
export async function planIdea(task) {
  const { askJSON } = await import('./claude.js');
  const { PLAIN_ENGLISH } = await import('./explain.js');
  const { data: project } = await db.from('team_projects').select('*').eq('id', task.input.project_id).single();
  if (!project) throw new Error('Project not found');
  await say('manager', `Planning your idea: ${project.idea.slice(0, 80)}`);
  // Fast model: you're waiting for this. Planning is a short, structured job.
  const plan = await askJSON({ agentId: 'manager', cheap: true, maxTokens: 1600, system: `${PLAIN_ENGLISH}\n${PLAN_SYSTEM(capabilityList())}`,
    prompt: `Owner's idea: ${project.idea}\nBusiness: KJ Agentic, College Station TX (local website agency, Etsy shop, dropshipping store, sports marketing for KJ's Picks, small social brands).` });
  const steps = (plan.steps || []).filter((s) => CAPABILITIES[s.need]).slice(0, 6);
  const dropped = (plan.steps || []).filter((s) => !CAPABILITIES[s.need]).map((s) => s.title);
  const title = String(plan.title || project.title).slice(0, 120);
  const wf = await ensureWorkflow({ dedupeKey: `project:${project.id}`, division: 'hq', kind: 'project', objective: `Project: ${title}`, stage: 'plan_review',
    owner: 'manager', subjectType: 'project', subjectId: project.id, nextAction: 'Owner approves the plan' });
  const fullPlan = { ...plan, title, steps, owner_tasks: [...(plan.owner_tasks || []), ...dropped.map((d) => `Not something the team can do yet: ${d}`)] };
  await db.from('team_projects').update({ title, plan: fullPlan, status: 'waiting_approval', workflow_id: wf.id, updated_at: now() }).eq('id', project.id);
  const a = await requestApproval({ agentId: 'manager', kind: 'project_plan', division: 'hq', workflowId: wf.id,
    title: `Start project: ${title} (${steps.length} step${steps.length === 1 ? '' : 's'})`,
    reason: plan.goal || project.idea, expectedOutcome: steps.map((s) => `${s.n}. ${CAPABILITIES[s.need].agent}: ${s.title}`).join(' · '),
    uncertainty: (plan.risks || []).join('; ') || null,
    scope: `Approving starts these steps (small AI cost each). Anything public (a website going live, posts, emails) still asks you first. ${fullPlan.owner_tasks.length ? `You'll need to: ${fullPlan.owner_tasks.join('; ')}` : ''}`,
    reversible: true, costUsd: 0, maxExposureUsd: 0,
    payload: { project_id: project.id, plan_text: [plan.plain_english, '', ...steps.map((s) => `${s.n}. ${s.title} (${CAPABILITIES[s.need].label}, by ${CAPABILITIES[s.need].agent})${s.after ? ` after step ${s.after}` : ''}`)].join('\n'), steps } });
  await db.from('team_projects').update({ approval_id: a.id }).eq('id', project.id);
  await say('manager', `Plan ready for your approval: ${title}`, 'success');
  return { project_id: project.id, steps: steps.length, approval_id: a.id };
}

/** Executor: the owner approved a project plan → create the steps as requests (in order, with dependencies). */
export async function startProject(a) {
  const p = a.payload;
  const { data: project } = await db.from('team_projects').select('*').eq('id', p.project_id).single();
  const steps = (p.steps || []).filter((s) => CAPABILITIES[s.need]);
  const ids = {};
  for (const s of steps) {
    const r = await requestWork({ fromAgent: 'manager', need: s.need, title: s.title, brief: { ...(s.brief || {}), why: s.why, project_title: project?.title },
      division: CAPABILITIES[s.need].agent.startsWith('ds_') ? 'dropship' : null, workflowId: project?.workflow_id, projectId: p.project_id,
      dependsOn: s.after && ids[s.after] ? ids[s.after] : null, dedupeKey: `project:${p.project_id}:step:${s.n}` });
    ids[s.n] = r.id;
  }
  await db.from('team_projects').update({ status: 'active', updated_at: now() }).eq('id', p.project_id);
  await advance(project?.workflow_id, 'manager', { stage: 'in_progress', status: 'active', nextAction: 'Agents are working on the steps' });
  return { note: `Project started: ${steps.length} step(s) handed to the team. Public results will still ask for your approval.` };
}
