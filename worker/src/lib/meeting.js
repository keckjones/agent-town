// The morning meeting in the War Room.
// Once a day the lead of each department and the Big Boss meet. Each lead reports ONLY what the records show
// (tasks finished, failures, approvals waiting on you, money that actually came in), hears what the others said,
// and can ask another team for help. Those asks become real team requests. The Big Boss closes with the day's focus.
// Nothing public, paid or irreversible comes out of a meeting: requests still end in your approvals.
import { db, say, addDocument } from './db.js';
import { requestWork, capabilityList, CAPABILITIES } from './collab.js';
import { PLAIN_ENGLISH } from './explain.js';
import { config } from '../config.js';

const DEPTS = {
  agency: 'Local Website Agency', sports: 'Sports Platform Marketing', etsy: 'Etsy Commerce', dropship: 'Dropshipping Commerce',
  realestate: 'Real Estate Wholesaling', media: 'Brands, Social & Video', ventures: 'Research & New Ventures',
  customers: 'Customer Operations', finance: 'Finance & Performance', hq: 'Risk & Workflow Improvement',
};
const MAX_REQUESTS = 3;
const now = () => new Date().toISOString();
export const localDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: config.timezone });
const deptOf = (a) => (a.id === 'manager' || String(a.id).startsWith('ceo_') ? 'exec' : DEPTS[a.division] ? a.division : 'hq');

const LEAD_SYSTEM = (name, dept) => `You are ${name}, the lead of ${dept} on a small team of AI agents that runs a one-person business.
You are speaking in the daily morning meeting in the War Room, with the other department leads and the Big Boss.
Rules:
- Report ONLY what is in the facts you are given. Never invent numbers, customers, sales, results or progress.
  If the facts show nothing happened, say so plainly.
- 1 to 3 short sentences: what happened since yesterday, what is stuck or waiting on the owner, what you will do next.
- You may react to something another lead said if it affects your team.
- If your team needs something another team makes, add it to "asks" (at most 1), using ONLY a need from the list. Don't ask for things your own team does.
- ${PLAIN_ENGLISH}`;

const CLOSE_SYSTEM = `You are the Big Boss (the executive orchestrator) closing the daily morning meeting of a small team of AI agents.
You have heard every department lead. Write the day's focus and up to 4 decisions (priorities for the team today).
Rules: use only what the leads said and the facts given. You cannot approve, spend money or change permissions;
anything public still goes to the owner's Approvals, so say "ask the owner" for those. ${PLAIN_ENGLISH}
Return JSON {"focus": "one line", "decisions": ["..."], "plain_english": "2-3 sentence summary for the owner"}.`;

/** Facts per department for the last 24 hours, straight from the records. */
async function gatherFacts() {
  const since = new Date(Date.now() - 864e5).toISOString();
  const yday = localDate(new Date(Date.now() - 864e5));
  const [ag, done, open, appr, wfs, reqs, money, links] = await Promise.all([
    db.from('agents').select('id, name, division, enabled'),
    db.from('tasks').select('agent_id, kind, status, error').in('status', ['done', 'failed']).gte('finished_at', since).limit(1000),
    db.from('tasks').select('agent_id, kind, status').in('status', ['queued', 'running']).limit(500),
    db.from('approvals').select('title, division, agent_id').eq('status', 'pending').limit(300),
    db.from('workflows').select('division, status, objective, blockers').in('status', ['active', 'blocked', 'waiting_approval']).limit(500),
    db.from('work_requests').select('division, need, title, status, from_agent, assigned_agent').in('status', ['open', 'queued', 'in_progress', 'blocked', 'waiting_approval']).limit(200),
    db.from('ledger').select('division, amount_usd, basis, category').gte('occurred_on', yday).limit(500),
    db.from('published_links').select('title, kind, platform, created_by').gte('created_at', since).limit(50),
  ]);
  const agents = (ag.data || []).filter((a) => a.enabled !== false);
  const deptByAgent = Object.fromEntries(agents.map((a) => [a.id, deptOf(a)]));
  const f = {};
  const D = (d) => (f[d] ||= { finished: {}, failed: [], queued_or_running: 0, waiting_on_owner: [], workflows: { active: 0, blocked: 0, waiting_approval: 0 }, blockers: [], open_requests: [], money_in_usd: 0, went_live: [] });
  for (const t of done.data || []) { const d = D(deptByAgent[t.agent_id] || 'hq'); if (t.status === 'done') d.finished[t.kind] = (d.finished[t.kind] || 0) + 1; else d.failed.push(`${t.kind}: ${String(t.error || '').slice(0, 80)}`); }
  for (const t of open.data || []) D(deptByAgent[t.agent_id] || 'hq').queued_or_running++;
  for (const a of appr.data || []) D(a.division && DEPTS[a.division] ? a.division : deptByAgent[a.agent_id] || 'hq').waiting_on_owner.push(a.title);
  for (const w of wfs.data || []) { const d = D(DEPTS[w.division] ? w.division : 'hq'); d.workflows[w.status]++; if (w.status === 'blocked' && w.blockers) d.blockers.push(`${w.objective}: ${w.blockers}`.slice(0, 140)); }
  for (const r of reqs.data || []) { const dep = deptByAgent[r.assigned_agent] || 'hq'; D(dep).open_requests.push(`${r.title} (${r.status}, asked by ${r.from_agent})`); }
  for (const m of money.data || []) if (m.basis === 'actual' && Number(m.amount_usd) > 0 && m.category !== 'cost') D(DEPTS[m.division] ? m.division : 'hq').money_in_usd += Number(m.amount_usd);
  for (const l of links.data || []) D(deptByAgent[l.created_by] || 'media').went_live.push(`${l.title} (${l.platform} ${l.kind})`);
  for (const d of Object.values(f)) { d.failed = d.failed.slice(0, 5); d.waiting_on_owner = d.waiting_on_owner.slice(0, 6); d.blockers = d.blockers.slice(0, 4); d.open_requests = d.open_requests.slice(0, 5); d.money_in_usd = Math.round(d.money_in_usd * 100) / 100; }
  // Each department's lead: whoever finished the most work in the last day (ties: first by id).
  const counts = {};
  for (const t of done.data || []) counts[t.agent_id] = (counts[t.agent_id] || 0) + 1;
  const leads = {};
  for (const a of agents.sort((x, y) => x.id.localeCompare(y.id))) {
    const d = deptByAgent[a.id]; if (d === 'exec') continue;
    if (!leads[d] || (counts[a.id] || 0) > (counts[leads[d].id] || 0)) leads[d] = a;
  }
  return { facts: f, leads, boss: agents.find((a) => a.id === 'manager') };
}

const quiet = (x) => !x || (!Object.keys(x.finished).length && !x.failed.length && !x.queued_or_running && !x.waiting_on_owner.length
  && !x.workflows.active && !x.workflows.blocked && !x.workflows.waiting_approval && !x.open_requests.length && !x.money_in_usd && !x.went_live.length);

/** Claim today's meeting row. Returns null when today's meeting already happened (or is happening). */
async function claim(force, by) {
  const day = localDate();
  const fresh = { held_on: day, status: 'in_session', started_at: now(), ended_at: null, attendees: [], notes: { lines: [] }, error: null, created_by: by };
  const { data, error } = await db.from('meetings').insert(fresh).select().single();
  if (!error) return data;
  if (!/duplicate|unique/i.test(error.message)) throw new Error(error.message);
  const { data: cur } = await db.from('meetings').select('*').eq('held_on', day).single();
  const stale = cur.status === 'in_session' && Date.now() - new Date(cur.started_at).getTime() > 15 * 60000;
  if (cur.status === 'in_session' && !stale) return null;
  if (cur.status === 'done' && !force) return null;
  const { data: re } = await db.from('meetings').update(fresh).eq('id', cur.id).eq('status', cur.status).select();
  return re?.[0] || null;
}

/** Manager task `morning_meeting`. input.force re-holds today's meeting (the "Start meeting now" button). */
export async function morningMeeting(task = {}) {
  const m = await claim(!!task.input?.force, task.created_by || 'schedule');
  if (!m) return { skipped: "Today's meeting already happened (or is in session)." };
  const { askJSON } = await import('./claude.js');
  try {
    const { facts, leads, boss } = await gatherFacts();
    const order = Object.keys(DEPTS).filter((d) => leads[d]);
    const attendees = ['manager', ...order.map((d) => leads[d].id)];
    const notes = { lines: [], decisions: [], requests: [], source: 'Built from your records for the last 24 hours. Lines are summaries by each lead, not new facts.' };
    await db.from('meetings').update({ attendees, notes }).eq('id', m.id);
    await say('manager', `Morning meeting started in the War Room (${attendees.length} in the room).`, 'info', { meeting_id: m.id });

    const caps = capabilityList();
    for (const d of order) {
      const lead = leads[d], x = facts[d];
      let line;
      if (quiet(x)) line = { agent: lead.id, dept: d, said: 'Nothing new on record for our team since yesterday. No work waiting on you.', asks: [], quiet: true };
      else {
        const transcript = notes.lines.map((l) => `${DEPTS[l.dept]} (${l.agent}): ${l.said}`).join('\n') || '(you are first)';
        try {
          const r = await askJSON({ agentId: lead.id, cheap: true, maxTokens: 500, system: LEAD_SYSTEM(lead.name, DEPTS[d]),
            prompt: `Facts for ${DEPTS[d]} (last 24 hours, from the records):\n${JSON.stringify(x)}\n\nSaid so far in the meeting:\n${transcript}\n\nNeeds you can ask other teams for:\n${caps}\n\nReturn JSON {"said": "...", "asks": [{"need": "...", "title": "...", "why": "..."}]}` });
          line = { agent: lead.id, dept: d, said: String(r.said || '').slice(0, 600), asks: (Array.isArray(r.asks) ? r.asks : []).slice(0, 1) };
        } catch (e) { line = { agent: lead.id, dept: d, said: `Couldn't prepare an update (${String(e.message).slice(0, 80)}).`, asks: [] }; }
      }
      // Asks become real team requests, routed to the agent who does that work.
      for (const a of line.asks) {
        const cap = CAPABILITIES[a.need];
        if (!cap || cap.agent === lead.id || notes.requests.length >= MAX_REQUESTS) { a.skipped = !cap ? 'not something the team can do' : cap.agent === lead.id ? 'own team' : 'meeting limit reached'; continue; }
        const req = await requestWork({ fromAgent: lead.id, need: a.need, title: String(a.title || a.need).slice(0, 160), brief: { why: a.why, from_meeting: m.held_on, question: a.title },
          division: DEPTS[d] ? d : null, dedupeKey: `meeting:${m.held_on}:${a.need}:${String(a.title || '').toLowerCase().replace(/\W+/g, '-').slice(0, 60)}` });
        a.request_id = req.id;
        if (!notes.requests.some((x) => x.id === req.id)) notes.requests.push({ id: req.id, need: a.need, title: req.title, from: lead.id, to: cap.agent });
      }
      notes.lines.push(line);
      await db.from('meetings').update({ notes }).eq('id', m.id);   // the dashboard shows each line as it's said
    }

    const all = notes.lines.map((l) => `${DEPTS[l.dept]} (${l.agent}): ${l.said}`).join('\n');
    let close;
    try {
      close = await askJSON({ agentId: 'manager', cheap: true, maxTokens: 700, system: CLOSE_SYSTEM,
        prompt: `What the leads said:\n${all || '(no departments have agents yet)'}\n\nRequests the team made to each other: ${JSON.stringify(notes.requests)}\nApprovals waiting on the owner: ${Object.values(facts).reduce((s, x) => s + x.waiting_on_owner.length, 0)}` });
    } catch (e) { close = { focus: 'Keep going on what is already in progress.', decisions: [], plain_english: `The closing summary couldn't be written (${String(e.message).slice(0, 80)}).` }; }
    notes.focus = String(close.focus || '').slice(0, 200);
    notes.decisions = (Array.isArray(close.decisions) ? close.decisions : []).slice(0, 4).map((s) => String(s).slice(0, 240));
    notes.plain_english = String(close.plain_english || '').slice(0, 800);

    const md = [`**Today's focus:** ${notes.focus}`, '', notes.plain_english, '', '**Around the room:**',
      ...notes.lines.map((l) => `- **${DEPTS[l.dept]}** (${l.agent}): ${l.said}`), '',
      ...(notes.decisions.length ? ['**Decisions:**', ...notes.decisions.map((s) => `- ${s}`), ''] : []),
      ...(notes.requests.length ? ['**Teams asked each other for:**', ...notes.requests.map((r) => `- ${r.title} (${r.from} → ${r.to})`), ''] : []),
      `_${notes.source}_`].join('\n');
    const doc = await addDocument('manager', 'meeting_notes', `Morning meeting: ${m.held_on}`, md, { meeting_id: m.id }).catch(() => null);
    await db.from('meetings').update({ status: 'done', ended_at: now(), notes, document_id: doc?.id || null }).eq('id', m.id);
    await say('manager', `Morning meeting done. Focus: ${notes.focus}${notes.requests.length ? ` (${notes.requests.length} team request${notes.requests.length > 1 ? 's' : ''})` : ''}`, 'success', { meeting_id: m.id });
    return { meeting_id: m.id, lines: notes.lines.length, requests: notes.requests.length };
  } catch (e) {
    await db.from('meetings').update({ status: 'failed', ended_at: now(), error: String(e.message).slice(0, 300) }).eq('id', m.id);
    throw e;
  }
}
