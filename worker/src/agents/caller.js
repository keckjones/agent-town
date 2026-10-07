// Phone Sales: prepares a researched, honest call script and a call task.
// AI-voice calling stays OFF unless the person gave written consent AND a voice provider is connected
// (FCC: AI voices are "artificial voice" under the TCPA). Until then, calls are manual tasks for Keck.
import { config } from '../config.js';
import { db, must, say, getSettings, enqueue } from '../lib/db.js';
import { ask, askJSON } from '../lib/claude.js';
import { findWorkflow, advance, logEvent } from '../lib/workflows.js';

const OUTCOMES = ['no_answer', 'voicemail', 'wrong_number', 'declined', 'do_not_contact', 'interested', 'meeting_booked',
  'proposal_requested', 'agreement_sent', 'agreement_signed', 'payment_received'];

function callingHoursOk(tz) {
  const h = Number(new Date().toLocaleString('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }));
  const d = new Date().toLocaleString('en-US', { timeZone: tz, weekday: 'short' });
  return h >= 9 && h < 17 && !['Sat', 'Sun'].includes(d);
}

export const handlers = {
  async prepare_call(task) {
    const p = must(await db.from('prospects').select('*').eq('id', task.input.prospect_id).single());
    if (p.opted_out) return { skipped: 'opted out' };
    const { data: open } = await db.from('call_tasks').select('id').eq('prospect_id', p.id).in('status', ['ready', 'scheduled']).maybeSingle();
    if (open) return { exists: open.id };
    const settings = await getSettings();
    const { data: consent } = await db.from('consents').select('kind, evidence, created_at').eq('subject_type', 'prospect').eq('subject_id', p.id).eq('channel', 'call').eq('kind', 'written').limit(1);
    const { data: optout } = await db.from('consents').select('id').eq('subject_type', 'prospect').eq('subject_id', p.id).eq('kind', 'opt_out').limit(1);
    const { data: history } = await db.from('outreach_messages').select('direction, kind, subject, created_at').eq('prospect_id', p.id).order('created_at');
    const eligibility = {
      ai_allowed: false,
      reasons: [
        consent?.length ? `Written request to be called on ${new Date(consent[0].created_at).toLocaleDateString('en-US')}` : 'No written consent for automated calls; a listed business number is not consent',
        'No AI voice provider connected',
        optout?.length ? 'Has opted out: do not call' : null,
      ].filter(Boolean),
      calling_hours: 'Weekdays 9 AM–5 PM in their time zone',
      in_hours_now: callingHoursOk(p.timezone || 'America/Chicago'),
    };
    if (optout?.length) return { skipped: 'opted out' };

    const facts = { name: p.name, category: p.category, address: p.address, phone: p.phone, website: p.website || 'none (verified)',
      findings: p.audit?.findings || [], rating: p.rating, reviews: p.review_count, prior_contact: history || [] };
    const pricing = settings.agency_pricing;
    const script = await ask({
      agentId: 'caller', maxTokens: 1800,
      system: `You write phone scripts for Keck Jones of ${config.business.name || 'KJ Agentic'}, a local web designer. The caller is Keck himself (a person), unless stated otherwise.
Use ONLY the verified facts given. Never invent research, promise revenue or rankings, imply a prior relationship, or pressure.
Use the approved pricing only. Keep it natural, short, and question-led.`,
      prompt: `Verified facts: ${JSON.stringify(facts)}
Approved offer: ${settings.outreach_offer}
Approved pricing: ${JSON.stringify(pricing)} (never discount more than ${pricing.max_discount_pct || 0}%)
Booking link: ${config.bookingUrl || 'none: offer to email times'}
Reason for calling: ${task.input.reason || 'follow-up'}

Write the script in sections: 1) Opening (identify yourself and the business, ask if now is OK). 2) One verified observation. 3) Two discovery questions.
4) Offer (approved scope and price range). 5) Close: meeting or proposal by email (confirm name, email, and best time). 6) Answers to 4 likely objections.
7) If they say "don't call again": apologize, confirm they won't be called, end the call. 8) Voicemail version (under 25 seconds).`,
    });
    const goal = (history || []).some((h) => h.direction === 'in') ? 'Book a meeting or send the proposal' : 'Book a short meeting or get permission to email a proposal';
    const { data: ct } = await db.from('call_tasks').insert({ prospect_id: p.id, mode: 'manual', status: 'ready', objective: goal,
      phone: task.input.callback_number || p.phone, local_tz: p.timezone || 'America/Chicago', eligibility, script }).select().single();
    const wf = await findWorkflow('prospect', p.id, 'agency_lead');
    await advance(wf?.id, 'caller', { stage: 'contact', owner: 'caller', nextAction: `Keck calls ${p.phone} (script ready)`,
      note: `Manual call task #${ct.id}: ${eligibility.reasons[0]}` });
    await say('caller', `Call script for ${p.name} is ready in Phone Sales.`, 'success');
    return { call_task: ct.id, eligibility };
  },

  /** Owner records what happened on a call; the system takes the next step. */
  async record_outcome(task) {
    const { call_task_id, outcome, notes = '', email = null, meeting_at = null } = task.input;
    if (!OUTCOMES.includes(outcome)) throw new Error(`Unknown outcome ${outcome}`);
    const ct = must(await db.from('call_tasks').select('*').eq('id', call_task_id).single());
    const p = must(await db.from('prospects').select('*').eq('id', ct.prospect_id).single());
    const report = await askJSON({
      agentId: 'caller', cheap: true, maxTokens: 900,
      system: 'You turn call notes into a factual call report. Do not add anything that is not in the notes.',
      prompt: `Business: ${p.name}. Outcome: ${outcome}. Notes (verbatim from Keck): """${notes}"""
Return JSON {"summary": "...", "needs": ["..."], "objections": ["..."], "next_step": "...", "next_step_deadline": "YYYY-MM-DD or null", "owner_action": "exactly what Keck must do, or null"}`,
    });
    await db.from('call_tasks').update({ status: 'done', outcome, report: { ...report, notes, meeting_at, recorded_at: new Date().toISOString(), recording: 'none' }, updated_at: new Date().toISOString() }).eq('id', ct.id);
    const wf = await findWorkflow('prospect', p.id, 'agency_lead');
    await logEvent(wf?.id, 'caller', 'result', `Call outcome: ${outcome.replace(/_/g, ' ')}. ${report.summary}`);

    const patch = { updated_at: new Date().toISOString() };
    if (email && !p.email) { patch.email = email; patch.contact_sources = [...(p.contact_sources || []), { field: 'email', value: email, source: 'given on phone call', observed_at: new Date().toISOString() }]; }
    if (outcome === 'do_not_contact') {
      Object.assign(patch, { opted_out: true, deal_stage: 'lost', next_step: null });
      await db.from('consents').insert({ subject_type: 'prospect', subject_id: p.id, channel: 'call', kind: 'opt_out', evidence: notes || 'Asked not to be contacted on a call', source: `call ${ct.id}` });
      if (p.email || email) await db.from('suppression').upsert({ email: (email || p.email).toLowerCase(), reason: 'asked on a call' }, { onConflict: 'email' });
      await db.from('approvals').update({ status: 'rejected', decision_note: 'Cancelled: asked not to be contacted' }).eq('prospect_id', p.id).eq('status', 'pending');
      await advance(wf?.id, 'caller', { stage: 'closed', status: 'lost', nextAction: null });
    } else if (outcome === 'declined') { Object.assign(patch, { deal_stage: 'lost', next_step: null }); await advance(wf?.id, 'caller', { stage: 'closed', status: 'lost', nextAction: null }); }
    else if (['interested', 'proposal_requested'].includes(outcome)) {
      Object.assign(patch, { deal_stage: 'replied', replied_at: new Date().toISOString(), next_step: 'Send proposal' });
      if (email || p.email) await enqueue('postmaster', 'draft_proposal', { prospect_id: p.id }, { createdBy: 'caller', priority: 2 });
      await advance(wf?.id, 'caller', { stage: 'prepare_proposal', owner: email || p.email ? 'postmaster' : 'caller', nextAction: email || p.email ? 'Proposal being drafted' : 'Get their email address' });
    } else if (outcome === 'meeting_booked') {
      Object.assign(patch, { deal_stage: 'meeting', next_step: `Meeting ${meeting_at || '(time not recorded)'}`, next_step_at: meeting_at });
      await advance(wf?.id, 'caller', { stage: 'meeting', nextAction: `Meeting ${meeting_at || ''}` });
    } else if (outcome === 'agreement_signed') Object.assign(patch, { deal_stage: 'won' });
    else if (['no_answer', 'voicemail'].includes(outcome)) {
      Object.assign(patch, { next_step: 'Try calling again', next_step_at: new Date(Date.now() + 2 * 864e5).toISOString() });
    } else if (outcome === 'wrong_number') Object.assign(patch, { next_step: 'Find a correct number', phone: null });
    await db.from('prospects').update(patch).eq('id', p.id);
    return { outcome, report };
  },
};

export { OUTCOMES };
