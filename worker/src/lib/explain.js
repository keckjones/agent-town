// Plain-English explanations for the owner, who may be new to each kind of business.
// Written by the cheap model from the approval card's own fields; never invents facts beyond them.
import { db } from './db.js';
import { ask } from './claude.js';

export const PLAIN_ENGLISH = `The owner is new to this kind of business. Whenever you write something the owner will read
(a memo, report, summary, reason or recommendation), start with a short "In plain English" part: what this is, how it makes
or saves money, what it costs, what could go wrong, and what happens next. Use everyday words; the first time you use any
jargon (CAC, ARV, MAO, margin, conversion, CTR, SEO, POD, comps, etc.) explain it in parentheses.`;

const SYSTEM = `You explain decisions to a business owner who is new to this field. Use ONLY the facts given; never add numbers,
names or promises that are not in the card. Write 3-6 short sentences, no headings, no bullet points:
1) what this is, in everyday words; 2) what happens if they approve (and whether it can be undone);
3) why the agent suggests it and what it could earn or cost; 4) the main risk. Define any jargon in parentheses.`;

/** Generate and store approvals.explain. Never throws (the dashboard has a built-in fallback explanation). */
export async function explainApproval(row) {
  try {
    const p = { ...(row.payload || {}) };
    for (const k of Object.keys(p)) if (typeof p[k] === 'string' && p[k].length > 600) p[k] = `${p[k].slice(0, 600)}…`;
    delete p.html; delete p.body_html;
    const text = await ask({ agentId: row.agent_id || 'manager', cheap: true, maxTokens: 350, system: SYSTEM,
      prompt: JSON.stringify({ kind: row.kind, title: row.title, reason: row.reason, expected_outcome: row.expected_outcome, uncertainty: row.uncertainty,
        scope: row.scope, reversible: row.reversible, cost_usd: row.cost_usd, max_exposure_usd: row.max_exposure_usd, standing: row.standing, details: p }) });
    if (text) await db.from('approvals').update({ explain: text.slice(0, 1500) }).eq('id', row.id);
  } catch { /* budget reached, migration 006 not run, etc. */ }
}
