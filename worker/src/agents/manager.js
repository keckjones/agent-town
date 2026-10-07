// Mayor Mae: looks at the whole town, decides what everyone should do next, and queues the work.
import { db, say, enqueue, getSettings, addDocument, startOfToday } from '../lib/db.js';
import { requestWork, planIdea, capabilityList, CAPABILITIES } from '../lib/collab.js';
import { PLAIN_ENGLISH } from '../lib/explain.js';
import { morningMeeting } from '../lib/meeting.js';
import { askJSON, spentToday } from '../lib/claude.js';
import { emailReady } from '../config.js';

// What the manager is allowed to assign. Keep in sync with agents/index.js.
export const ASSIGNABLE = {
  research: { kinds: ['research'], input: '{"topic": "a specific research question"}' },
  scout: { kinds: ['find_prospects'], input: '{"category": "e.g. hair salon", "city": "optional, one of the outreach areas", "limit": 10}' },
  etsy: { kinds: ['research_products'], input: '{"focus": "optional product niche"}' },
  opportunity: { kinds: ['propose_opportunities'], input: '{"focus": "optional"}' },
  sports: { kinds: ['draft_content'], input: '{}' },
  marketer: { kinds: ['plan_campaign'], input: '{"focus": "what the campaign should achieve"}' },
  ds_research: { kinds: ['research_niches'], input: '{"focus": "optional niche"}' },
  re_market: { kinds: ['market_report'], input: '{}' },
  strategy: { kinds: ['plan_calendar'], input: '{"brand_id": n}' },
};

const SYSTEM = `You are the manager of a small team of AI agents running a one-person online business.
Your job: move the business toward its weekly revenue goal with the least wasted effort and money.
Divisions: local website agency (earns fastest), sports platform marketing, Etsy shop, new ventures.
Priorities: (1) keep the agency pipeline full but don't outrun the owner's approvals; (2) Etsy research only a few times a week;
(3) opportunity memos at most twice a week; (4) sports content only when the data feed is connected and fresh;
(5) dropshipping niche research at most weekly and only while Shopify is connected or a niche is being validated; (6) real estate market notes weekly;
(7) never propose new brands yourself (the owner starts those); keep approved brands' calendars filled only within their approved scope.
Never assign work to a division whose integration is missing if the work would be wasted. Spend little; budgets are real money.
Don't pile up work: if many approvals are waiting for the owner, create fewer new drafts and say so.
Stay within the daily budget. Only assign tasks from the allowed list.
In the summary and focus you write for the owner: ${PLAIN_ENGLISH}`;

async function snapshot() {
  const settings = await getSettings();
  const weekAgo = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
  const [stages, approvals, revenue, queued, failed, docs] = await Promise.all([
    db.from('prospects').select('stage'),
    db.from('approvals').select('kind, status').in('status', ['pending', 'approved']),
    db.from('revenue').select('amount').gte('received_at', weekAgo),
    db.from('tasks').select('agent_id').in('status', ['queued', 'running']),
    db.from('tasks').select('agent_id, kind, error').eq('status', 'failed').gte('finished_at', startOfToday()).limit(10),
    db.from('documents').select('kind, title, created_at').order('created_at', { ascending: false }).limit(12),
  ]);
  const [{ data: ints }, { data: wfs }, { data: opps }, { data: prods }] = await Promise.all([
    db.from('integrations').select('id, status'),
    db.from('workflows').select('division, status'),
    db.from('opportunities').select('created_at').gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString()),
    db.from('products').select('stage, created_at').gte('created_at', new Date(Date.now() - 7 * 864e5).toISOString()),
  ]);
  const tally = (rows, key) => (rows || []).reduce((m, r) => ((m[r[key]] = (m[r[key]] || 0) + 1), m), {});
  return {
    settings: {
      weekly_goal: settings.weekly_goal, daily_budget_usd: settings.daily_budget_usd, city: settings.outreach_city,
      categories: settings.outreach_categories, business_focus: settings.business_focus, owner_notes: settings.manager_notes,
    },
    spent_today_usd: Number((await spentToday()).toFixed(2)),
    revenue_last_7_days: (revenue.data || []).reduce((s, r) => s + Number(r.amount), 0),
    outreach_email_configured: emailReady(),
    prospect_pipeline: tally(stages.data, 'stage'),
    approvals_waiting_on_owner: tally(approvals.data, 'kind'),
    tasks_in_queue_by_agent: tally(queued.data, 'agent_id'),
    failures_today: failed.data || [],
    recent_documents: docs.data || [],
    integrations: Object.fromEntries((ints || []).map((i) => [i.id, i.status])),
    workflows_by_division_status: (wfs || []).reduce((m, w) => { const k = `${w.division}:${w.status}`; m[k] = (m[k] || 0) + 1; return m; }, {}),
    opportunity_memos_last_7_days: (opps || []).length,
    etsy_concepts_last_7_days: (prods || []).length,
    now: new Date().toString(),
  };
}

export const handlers = {
  // You give the Big Boss an idea; it plans the steps with the team and asks you to approve the plan.
  plan_idea: planIdea,
  // Once a day: department leads + Big Boss meet in the War Room, report from the records, and ask each other for help.
  morning_meeting: morningMeeting,

  async plan(task) {
    await say('manager', 'Calling a town meeting to review progress...');
    const state = await snapshot();
    const allowed = Object.entries(ASSIGNABLE).map(([a, v]) => `- agent "${a}", kind "${v.kinds[0]}", input ${v.input}`).join('\n');

    const plan = await askJSON({
      agentId: 'manager', system: SYSTEM, maxTokens: 3000,
      prompt: `Current state of the business (JSON):\n${JSON.stringify(state, null, 2)}

Allowed task types:\n${allowed}

Decide the next batch of work (at most 8 tasks). Return JSON:
{"summary": "2-4 sentence status update for the owner", "focus_today": "one line", "owner_actions": ["things only the owner can do, e.g. approve emails"],
"tasks": [{"agent": "...", "kind": "...", "input": {...}, "priority": 1-9, "reason": "..."}],
"requests": [{"need": "...", "title": "...", "brief": {...}, "why": "..."}] (optional, at most 2: when one part of the business needs something another team makes)}

Team capabilities you can request (agents fulfil them; anything public still needs the owner's approval):
${capabilityList()}`,
    });

    let queued = 0;
    for (const t of (plan.tasks || []).slice(0, 8)) {
      const spec = ASSIGNABLE[t.agent];
      if (!spec || !spec.kinds.includes(t.kind)) continue;
      await enqueue(t.agent, t.kind, { ...(t.input || {}), reason: t.reason }, { priority: t.priority ?? 5 });
      queued++;
    }

    let requested = 0;
    for (const r of (plan.requests || []).slice(0, 2)) {
      if (!CAPABILITIES[r.need]) continue;
      await requestWork({ fromAgent: 'manager', need: r.need, title: r.title || r.need, brief: { ...(r.brief || {}), why: r.why } });
      requested++;
    }

    const md = [`**Focus:** ${plan.focus_today}`, '', plan.summary, '',
      '**Needs you:**', ...(plan.owner_actions || []).map((a) => `- ${a}`), '',
      '**Assigned:**', ...(plan.tasks || []).map((t) => `- ${t.agent}: ${t.kind}, ${t.reason}`),
      ...(requested ? ['', '**Asked the team for:**', ...(plan.requests || []).slice(0, 2).map((r) => `- ${r.title} (${r.need})`)] : [])].join('\n');
    await addDocument('manager', 'manager_plan', `Town meeting: ${new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}`, md, { state, plan });
    await say('manager', `${plan.focus_today} (${queued} tasks assigned)`, 'success');
    return { queued, summary: plan.summary };
  },
};
