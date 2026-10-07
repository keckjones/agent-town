// The Career Agent: your personal job search.
//  * Reviews each saved job against your resume and prepares an application packet (fit, gaps, tailored answers,
//    and the questions only you can answer). It never submits an application or certifies anything for you.
//  * Finds contacts with web research. An email address is used only if it is VERIFIED: you gave it, it appears
//    word-for-word on a public page we re-check, or the person emailed you. Guessed addresses are never used.
//    People without a verified address get a short LinkedIn note for YOU to send (no automated LinkedIn activity).
//  * Writes every email individually and checks it against every earlier email so no two read alike.
//  * Sends only from your school Gmail (keckjones@tamu.edu), up to your daily cap, one follow-up after
//    7 business days, and stops when someone replies, declines, opts out or bounces.
import { db, say, requestApproval, addDocument, download } from '../lib/db.js';
import { gmailSend, gmailThread, gmailSearch } from '../lib/gmail.js';
import { runOnce, retryable } from '../lib/actions.js';
import { PLAIN_ENGLISH } from '../lib/explain.js';
import { config } from '../config.js';

const now = () => new Date().toISOString();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
const ACTIVE = ['contacted', 'followed_up'];
const STOPPED = ['replied', 'declined', 'opted_out', 'bounced', 'do_not_contact'];

// ---------------------------------------------------------------- small helpers
export function addBusinessDays(date, n) {
  const d = new Date(date); let left = n;
  while (left > 0) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) left--; }
  return d.toISOString().slice(0, 10);
}
const words = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9'$%.]+/g, ' ').split(/\s+/).filter(Boolean);
function shingles(t, n = 4) { const w = words(t); const s = new Set(); for (let i = 0; i + n <= w.length; i++) s.add(w.slice(i, i + n).join(' ')); return s; }
/** Share of the smaller email's 4-word phrases that also appear in the other one (0 = nothing shared, 1 = identical). */
export function overlap(a, b) {
  const A = shingles(a), B = shingles(b);
  if (!A.size || !B.size) return 0;
  let k = 0; for (const x of A) if (B.has(x)) k++;
  return k / Math.min(A.size, B.size);
}
export const MAX_OVERLAP = 0.2;
const bodyOnly = (text, sig) => (sig && text.includes(sig) ? text.slice(0, text.indexOf(sig)) : text);

async function profile() {
  const { data, error } = await db.from('career_profile').select('*').eq('id', 1).maybeSingle();
  if (error) throw new Error('Career Office tables are missing: run supabase/011_career.sql.');
  return data;
}
// Your own answers (Career Office → Your answers). Only these may be stated; anything blank is never guessed.
export const ANSWER_LABELS = { work_authorized: 'Authorized to work in the US', sponsorship: 'Will need visa sponsorship (now or in the future)', start_date: 'Earliest full-time start date', relocate: 'Willing to relocate', salary: 'Salary expectations', paragon: 'Paragon: current status and exact dates' };
const yn = (v) => (v === true ? 'Yes' : v === false ? 'No' : v);
const known = (p) => Object.fromEntries(Object.entries(p.answers || {}).filter(([, v]) => v !== null && v !== undefined && v !== ''));
function answersRule(p) {
  const a = known(p);
  return [
    a.start_date ? `You may say full-time availability begins ${a.start_date}; never say "immediately".` : 'Never state a start date or availability to start immediately.',
    a.relocate === true ? 'You may say you are open to relocating when the role is in another city (only if relevant).' : 'Never state willingness to relocate.',
    'Never mention salary or compensation in an email.',
  ].join(' ');
}
const signatureOf = (p) => p.signature || [p.full_name || 'Keck Jones', p.phone, p.sender_email].filter(Boolean).join('\n');

// What the writer may and may not say. Kept strict on purpose: these go out under your name.
const WRITER_SYSTEM = (p) => `You write job-search emails in the first person AS ${p.full_name || 'the candidate'}, a graduate student.
They must read like a real person wrote them for this one recipient: natural, specific, short (90-170 words), professional, warm.
Hard rules:
- Use ONLY facts in the resume and profile below. Never invent licenses, certifications, deal or transaction experience, modeling
  skills, results, mutual connections or referrals. Never claim to know the recipient unless the notes say so.
- ${(p.rules?.never || []).join('\n- ') || 'Do not claim current employment anywhere unless the profile says so.'}
- ${answersRule(p)}
- Pick the ONE career track that fits this recipient and the role; don't list unrelated interests.
- Include: a specific reason for contacting this company/person, the most relevant part of the background, and a clear, modest ask
  (a short conversation, recruiting guidance, or consideration for a fitting role).
- If a resume is attached, mention it once. If not, don't.
- Do not reuse the openings, subjects or sentences listed under "Already used" — vary structure, opening line and subject.
- End the body with a sign-off line only (e.g. "Best," or "Thank you,"). The name and signature are added automatically.
Return JSON {"subject": "...", "body": "..."}.`;

const NOTE_SYSTEM = (p) => `You write a LinkedIn connection note (max 280 characters) in the first person as ${p.full_name || 'the candidate'}.
Natural and specific to this person's role and company; one clear reason for connecting; no invented facts, mutual connections or referrals;
no availability, relocation or salary statements. Different wording from the notes listed under "Already used". Return JSON {"note": "..."}.`;

const PACKET_SYSTEM = `You are a careful career advisor preparing an application packet for a graduate student.
Use only the resume and profile given. Never invent experience, licenses, certifications or deal experience.
Be honest about fit: roles titled "Associate" in investment banking usually expect prior banking or comparable experience; say so plainly
if the resume doesn't show it, and suggest whether to still apply or look for the analyst / new-grad version.
Write the "why this firm" and cover note so they could only be about this firm and role (no generic filler).
Answers must not state work authorization, sponsorship, start dates, salary, relocation, current-employment status or end dates,
demographic, disability or veteran information, or agree to any terms: put those in owner_questions instead.
${PLAIN_ENGLISH}
Return JSON {"track": "investment_banking|investment_analyst|supply_chain", "fit": {"score": 1-10, "summary": "...", "strengths": ["..."], "gaps": ["..."]},
"packet": {"why_company": "...", "cover_note": "...", "answers": [{"q": "...", "a": "..."}], "owner_questions": ["..."], "next_steps": ["..."]}}`;

// ---------------------------------------------------------------- writing (with the no-repeat check)
async function recentOutbound(limit = 60) {
  const { data } = await db.from('career_messages').select('id, subject, body, kind').eq('direction', 'out').in('status', ['sent', 'pending_approval', 'to_send_by_you', 'draft']).order('created_at', { ascending: false }).limit(limit);
  return data || [];
}
/** Draft an email (intro or follow-up) for one contact; regenerates until it doesn't read like any earlier email. */
export async function writeEmail(p, contact, kind, { job = null, previous = null, attach = true } = {}) {
  const { askJSON } = await import('../lib/claude.js');
  const sig = signatureOf(p);
  const past = await recentOutbound();
  const usedSubjects = new Set(past.map((m) => String(m.subject || '').toLowerCase().trim()));
  const usedOpenings = past.map((m) => String(bodyOnly(m.body, sig) || '').split(/\n/).map((l) => l.trim()).filter(Boolean).slice(1, 2).join(' ')).filter(Boolean).slice(0, 12);
  let best = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await askJSON({ agentId: 'career', maxTokens: 900, system: WRITER_SYSTEM(p),
      prompt: `Resume (source of truth):\n${p.resume_text}\n\nProfile goals: ${JSON.stringify(p.goals || {})}
Recipient: ${contact.name}, ${contact.title || ''} at ${contact.company}${contact.location ? ` (${contact.location})` : ''}. Track: ${contact.track || job?.track || 'choose the best fit'}.
Notes about this person / how we know them: ${contact.notes || 'none — this is a first contact; do not imply we have met'}
${job ? `Related role: ${job.title} at ${job.company}, ${job.location || ''}. ${job.fit?.summary || ''}` : ''}
Email type: ${kind === 'follow_up' ? `ONE polite follow-up, 60-110 words, referencing the earlier email below without repeating it. Earlier email:\n"""${previous?.body || ''}"""` : 'first outreach'}
Resume attached: ${attach ? 'yes' : 'no'}
Already used (don't repeat): subjects ${JSON.stringify([...usedSubjects].slice(0, 15))}; openings ${JSON.stringify(usedOpenings)}
${attempt ? `Your previous draft repeated phrases from an earlier email (overlap ${Math.round(best.score * 100)}%). Rewrite it with a different structure, opening and wording.` : ''}` });
    const subject = String(r.subject || '').trim().slice(0, 140), body = String(r.body || '').trim();
    if (!subject || !body) continue;
    const score = Math.max(0, ...past.map((m) => overlap(bodyOnly(m.body, sig), body)));
    const dupSubject = kind !== 'follow_up' && usedSubjects.has(subject.toLowerCase());
    const cand = { subject: kind === 'follow_up' && previous?.subject && !/^re:/i.test(subject) ? `Re: ${previous.subject}` : subject, body, score, dupSubject };
    if (!best || score < best.score) best = cand;
    if (score <= MAX_OVERLAP && !dupSubject) break;
  }
  if (!best) throw new Error('Could not write the email.');
  const problems = checkClaims(p, best.body, attach);
  return { ...best, text: `${best.body}\n\n${sig}`, problems };
}
/** Simple guardrails on top of the writer's rules (flags go on the approval card; auto-send is blocked when flagged). */
export function checkClaims(p, body, attach) {
  const t = String(body || '');
  const out = [];
  for (const co of p.rules?.not_current || []) if (new RegExp(`(currently|presently|now)\\s+(work(ing)?|employed|interning)\\s+(at|with|for)\\s+${co}`, 'i').test(t) || new RegExp(`${co}[^.]{0,40}\\b(currently|where I am now)`, 'i').test(t)) out.push(`Says you currently work at ${co}`);
  if (/\b(refer(r)?ed me|referral from)\b/i.test(t)) out.push('Mentions a referral');
  if (/\b(start (full[- ]time )?immediately|available immediately)\b/i.test(t)) out.push('Says you can start immediately');
  if (/\b(salary|compensation)\b/i.test(t)) out.push('Mentions pay');
  if (/\b(relocat\w*)\b/i.test(t) && p.answers?.relocate !== true) out.push('Mentions relocation, but you haven\'t said you will relocate');
  if (!attach && /\battach(ed)?\b/i.test(t)) out.push('Mentions an attachment, but none is attached');
  return out;
}
export async function writeNote(p, contact) {
  const { askJSON } = await import('../lib/claude.js');
  const past = (await db.from('career_messages').select('body').eq('kind', 'linkedin_note').limit(40)).data || [];
  let best = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await askJSON({ agentId: 'career', cheap: true, maxTokens: 300, system: NOTE_SYSTEM(p),
      prompt: `Resume:\n${p.resume_text}\n\nPerson: ${contact.name}, ${contact.title || ''} at ${contact.company} ${contact.location || ''}. Notes: ${contact.notes || 'none'}
Already used: ${JSON.stringify(past.slice(0, 10).map((x) => x.body))}` });
    const note = String(r.note || '').trim().slice(0, 300);
    const score = Math.max(0, ...past.map((m) => overlap(m.body, note)));
    if (!best || score < best.score) best = { note, score };
    if (score <= MAX_OVERLAP) break;
  }
  return best;
}

// ---------------------------------------------------------------- verification (never guessed addresses)
/** An address counts as verified only from you, from the person's own reply, or seen word-for-word on the page we re-fetch. */
export async function verifyContact(c) {
  if (!c.email) return { verified: false, why: 'no email' };
  if (['owner', 'reply'].includes(c.email_source)) return { verified: true, why: c.email_source };
  if (c.email_source !== 'page' || !c.email_source_url) return { verified: false, why: 'no source page' };
  try {
    const res = await fetch(c.email_source_url, { headers: { 'user-agent': 'Mozilla/5.0 (KJ Agentic career research)' }, signal: AbortSignal.timeout(15000) });
    const html = (await res.text()).toLowerCase().replace(/&#64;|&#x40;|\[at\]|\(at\)/g, '@');
    const ok = res.ok && html.includes(c.email.toLowerCase());
    return { verified: ok, why: ok ? 'found on the source page' : `not found on ${c.email_source_url}` };
  } catch (e) { return { verified: false, why: `couldn't open the source page (${e.message.slice(0, 60)})` }; }
}

// ---------------------------------------------------------------- sending
async function sentToday() {
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const { count } = await db.from('career_messages').select('id', { count: 'exact', head: true }).eq('direction', 'out').eq('status', 'sent').eq('via', 'gmail_api').gte('sent_at', start.toISOString());
  return count || 0;
}
/** Send one prepared message from the school Gmail. Called by the approval executor (or directly when auto-send is on). */
export async function sendCareerMessage(messageId, { approvalId = null } = {}) {
  const p = await profile();
  if (!p.sending_enabled) throw retryable(new Error('Career sending is not set up yet: in the Career Office, confirm the old ChatGPT "Keck Career Outreach" automation is turned off, then turn on sending.'));
  const { data: m } = await db.from('career_messages').select('*').eq('id', messageId).single();
  if (!m) throw new Error('Message not found');
  if (m.status === 'sent') return { already: true };
  const { data: c } = await db.from('career_contacts').select('*').eq('id', m.contact_id).single();
  if (!c || STOPPED.includes(c.status)) { await db.from('career_messages').update({ status: 'skipped' }).eq('id', m.id); return { skipped: `contact is ${c?.status || 'gone'}` }; }
  const v = await verifyContact(c);
  if (!v.verified) { await db.from('career_messages').update({ status: 'skipped' }).eq('id', m.id); throw new Error(`Not sent: ${c.email} isn't verified (${v.why}).`); }
  if (await sentToday() >= (p.daily_cap || 5)) { const e = new Error(`Daily limit of ${p.daily_cap || 5} career emails reached; this one goes out on the next weekday run.`); e.capped = true; throw e; }
  const attachments = [];
  if (m.attachment) {
    if (!p.resume_path) throw retryable(new Error('Career sending is not set up yet: upload your resume PDF in the Career Office.'));
    attachments.push({ filename: p.resume_filename || 'Resume.pdf', content: await download(p.resume_path), contentType: 'application/pdf' });
  }
  const r = await runOnce(`career:msg:${m.id}`, 'email', () => gmailSend({ to: m.to_email, subject: m.subject, text: m.body, attachments, fromName: p.full_name }, { account: 'career', threadId: m.thread_id || c.thread_id || null }));
  const info = r?.result || r || {};
  const due = m.kind === 'intro' ? addBusinessDays(new Date(), p.follow_up_business_days || 7) : null;
  await db.from('career_messages').update({ status: 'sent', via: 'gmail_api', sent_at: now(), gmail_id: info.id || null, thread_id: info.threadId || m.thread_id, follow_up_due: due, approval_id: approvalId }).eq('id', m.id);
  await db.from('career_contacts').update({ status: m.kind === 'follow_up' ? 'followed_up' : 'contacted', thread_id: info.threadId || c.thread_id, updated_at: now() }).eq('id', c.id);
  await say('career', `Sent from ${info.from || p.sender_email}: "${m.subject}" to ${c.name} (${c.company})${m.attachment ? ' with your resume' : ''}.`, 'success');
  return { sent: true, thread: info.threadId };
}

/** Put an email in front of you (Approvals) or, with auto-send on and nothing flagged, send it. */
async function queueEmail(p, contact, draft, { kind, attach, threadId = null }) {
  const { data: m } = await db.from('career_messages').insert({ contact_id: contact.id, direction: 'out', kind, subject: draft.subject, body: draft.text, to_email: contact.email,
    status: 'pending_approval', attachment: attach ? (p.resume_filename || 'Resume.pdf') : null, similarity: Math.round(draft.score * 100) / 100, thread_id: threadId }).select().single();
  if (p.auto_send && p.sending_enabled && !draft.problems.length && draft.score <= MAX_OVERLAP) {
    try { await sendCareerMessage(m.id); return { sent: true, id: m.id }; } catch (e) { if (!e.capped && !e.retryable) throw e; }
  }
  const a = await requestApproval({ agentId: 'career', kind: 'career_email', division: 'career', title: `${kind === 'follow_up' ? 'Follow-up' : 'Email'} to ${contact.name} (${contact.company})`,
    payload: { message_id: m.id, to: contact.email, from: p.sender_email, subject: draft.subject, body: draft.text, attachment: m.attachment },
    reason: `${kind === 'follow_up' ? `No reply ${p.follow_up_business_days || 7} business days after your first email. This is the only follow-up.` : `${contact.title || 'Contact'} at ${contact.company}. Address verified: ${contact.email_source === 'owner' ? 'you provided it' : contact.email_source === 'reply' ? 'they emailed you' : `seen on ${contact.email_source_url}`}.`}`,
    evidence: { similarity_to_earlier_emails: `${Math.round(draft.score * 100)}%`, flags: draft.problems, profile: contact.profile_source_url || contact.linkedin_url || null },
    reversible: false, expiresInHours: 96 });
  await db.from('career_messages').update({ approval_id: a.id }).eq('id', m.id);
  return { approval: a.id, id: m.id };
}

// ---------------------------------------------------------------- replies, bounces, opt-outs
export async function checkReplies() {
  const { data: cs } = await db.from('career_contacts').select('*').in('status', ACTIVE);
  let replies = 0;
  for (const c of cs || []) {
    try {
      let msgs = [];
      if (c.thread_id) msgs = await gmailThread(c.thread_id);
      else if (c.email) {
        // Sent before this system (e.g. by ChatGPT): find the conversation by address.
        const hits = await gmailSearch(`(from:${c.email} OR to:${c.email}) newer_than:90d`, 'career', 5);
        if (hits[0]) { await db.from('career_contacts').update({ thread_id: hits[0].threadId }).eq('id', c.id); msgs = await gmailThread(hits[0].threadId); }
      }
      const { data: lastOut } = await db.from('career_messages').select('sent_at').eq('contact_id', c.id).eq('direction', 'out').eq('status', 'sent').order('sent_at', { ascending: false }).limit(1);
      const since = lastOut?.[0]?.sent_at ? new Date(lastOut[0].sent_at).getTime() - 60000 : 0;
      for (const x of msgs) {
        if (x.mine || x.date < since) continue;
        const { data: seen } = await db.from('career_messages').select('id').eq('gmail_id', x.id).limit(1);
        if (seen?.length) continue;
        const bounce = /mailer-daemon|postmaster|mail delivery/i.test(x.from) || /address not found|undeliverable|delivery status notification/i.test(x.subject);
        const optout = !bounce && /\b(unsubscribe|remove me|stop emailing|not interested|no longer)\b/i.test(x.snippet);
        const status = bounce ? 'bounced' : optout ? 'declined' : 'replied';
        await db.from('career_messages').insert({ contact_id: c.id, direction: 'in', kind: bounce ? 'bounce' : 'reply', subject: x.subject, body: x.snippet, status: 'sent', via: 'gmail_api', gmail_id: x.id, thread_id: c.thread_id, sent_at: new Date(x.date).toISOString() });
        await db.from('career_contacts').update({ status, updated_at: now() }).eq('id', c.id);
        await db.from('career_messages').update({ follow_up_due: null }).eq('contact_id', c.id).eq('direction', 'out');
        await say('career', bounce ? `Email to ${c.name} (${c.company}) bounced. No more emails to that address.` : `${c.name} (${c.company}) ${optout ? 'declined' : 'replied'}: "${x.snippet.slice(0, 120)}". Follow-ups stopped${optout ? '' : '; open Gmail to answer'}.`, bounce ? 'warn' : 'success');
        replies++; break;
      }
    } catch (e) { if (/not connected/i.test(e.message)) return { replies, error: e.message }; console.error('career replies:', e.message); }
  }
  return { replies };
}

// ---------------------------------------------------------------- the handlers
export const handlers = {
  /** Weekday morning run: replies → follow-ups due → new verified contacts → LinkedIn notes → job packets → report. */
  async daily_run(task) {
    const p = await profile();
    if (!p?.resume_text) { await say('career', 'Career Office needs setup: run your private career setup file and upload your resume.', 'warn'); return { skipped: 'no resume' }; }
    const report = { date: today(), replies: 0, followups: [], intros: [], notes: [], packets: [], waiting: [] };
    const rr = await checkReplies(); report.replies = rr.replies; if (rr.error) report.waiting.push(rr.error);
    const cap = Math.max(0, (p.daily_cap || 5) - await sentToday());
    let budget = cap;
    const { data: pend } = await db.from('career_messages').select('contact_id').eq('status', 'pending_approval');
    const pending = new Set((pend || []).map((x) => x.contact_id));

    // 1) Follow-ups due (one per contact, ever).
    const { data: due } = await db.from('career_messages').select('*').eq('direction', 'out').eq('kind', 'intro').eq('status', 'sent').lte('follow_up_due', today()).order('follow_up_due');
    for (const m of due || []) {
      if (budget <= 0) break;
      const { data: c } = await db.from('career_contacts').select('*').eq('id', m.contact_id).single();
      if (!c || c.status !== 'contacted' || pending.has(c.id)) continue;
      const { data: already } = await db.from('career_messages').select('id').eq('contact_id', c.id).eq('kind', 'follow_up').limit(1);
      if (already?.length) continue;
      const d = await writeEmail(p, c, 'follow_up', { previous: m, attach: false });
      const q = await queueEmail(p, c, d, { kind: 'follow_up', attach: false, threadId: m.thread_id || c.thread_id });
      report.followups.push({ to: c.name, company: c.company, subject: d.subject, ...q }); budget--;
    }

    // 2) New outreach to verified contacts: one person per company per run (more for companies you named).
    const { data: fresh } = await db.from('career_contacts').select('*').eq('status', 'new').eq('channel', 'email').not('email', 'is', null).order('priority').order('created_at').limit(40);
    const perCo = {};
    const { data: jobs } = await db.from('career_jobs').select('*');
    for (const c of fresh || []) {
      if (budget <= 0) break;
      if (pending.has(c.id)) continue;
      const multi = (p.multi_contact_companies || []).some((x) => x.toLowerCase() === c.company.toLowerCase());
      if ((perCo[c.company] || 0) >= (multi ? 3 : 1)) continue;
      const { data: talking } = await db.from('career_contacts').select('id').eq('company', c.company).in('status', ['replied']).limit(1);
      if (talking?.length && !multi) continue;   // already in a conversation there
      const v = await verifyContact(c);
      await db.from('career_contacts').update({ email_verified: v.verified, last_verified_at: now(), notes: v.verified ? c.notes : `${c.notes ? `${c.notes} · ` : ''}Email not verified: ${v.why}` }).eq('id', c.id);
      if (!v.verified) { report.waiting.push(`${c.name} (${c.company}): email not verified (${v.why})`); continue; }
      const job = (jobs || []).find((j) => j.id === c.job_id) || null;
      const d = await writeEmail(p, c, 'intro', { job, attach: !!p.resume_path });
      const q = await queueEmail(p, c, d, { kind: 'intro', attach: !!p.resume_path });
      report.intros.push({ to: c.name, company: c.company, subject: d.subject, similarity: d.score, flags: d.problems, ...q });
      perCo[c.company] = (perCo[c.company] || 0) + 1; budget--;
    }

    // 3) People reachable only on LinkedIn: a short, unique note for you to send yourself (up to 3 a day).
    const { data: li } = await db.from('career_contacts').select('*').eq('status', 'new').eq('channel', 'linkedin').order('priority').limit(10);
    for (const c of (li || []).slice(0, 6)) {
      if (report.notes.length >= 3) break;
      const { data: has } = await db.from('career_messages').select('id').eq('contact_id', c.id).eq('kind', 'linkedin_note').limit(1);
      if (has?.length) continue;
      const n = await writeNote(p, c);
      await db.from('career_messages').insert({ contact_id: c.id, direction: 'out', kind: 'linkedin_note', body: n.note, status: 'to_send_by_you', via: 'you', similarity: Math.round(n.score * 100) / 100 });
      report.notes.push({ to: c.name, company: c.company });
    }

    // 4) Application packets for saved jobs (3 per run).
    for (const j of (jobs || []).filter((x) => x.status === 'saved').slice(0, 3)) { await handlers.review_job({ input: { job_id: j.id } }); report.packets.push(`${j.company}: ${j.title}`); }

    // 5) Contact research: one target company a day, each at most weekly.
    const targets = [...new Set([...(p.multi_contact_companies || []), ...(p.goals?.target_companies || [])])];
    const last = p.state?.researched || {};
    const next = targets.find((co) => !last[co] || Date.now() - new Date(last[co]).getTime() > 7 * 864e5);
    if (next && task?.input?.research !== false) { const r = await handlers.find_contacts({ input: { company: next } }).catch((e) => ({ error: e.message })); report.research = { company: next, ...r }; }

    const md = [`**Career run · ${report.date}**`, '',
      `- Replies noticed: ${report.replies}`,
      `- Follow-ups prepared: ${report.followups.length}${report.followups.map((x) => `\n  - ${x.to} (${x.company}): "${x.subject}"${x.sent ? ' — sent' : ' — waiting for your approval'}`).join('')}`,
      `- New emails prepared: ${report.intros.length}${report.intros.map((x) => `\n  - ${x.to} (${x.company}): "${x.subject}"${x.sent ? ' — sent' : ' — waiting for your approval'}${x.flags?.length ? ` ⚠ ${x.flags.join('; ')}` : ''}`).join('')}`,
      `- LinkedIn notes for you to send: ${report.notes.length}${report.notes.map((x) => `\n  - ${x.to} (${x.company})`).join('')}`,
      `- Application packets prepared: ${report.packets.length}${report.packets.map((x) => `\n  - ${x}`).join('')}`,
      report.research ? `- Contact research: ${report.research.company} (${report.research.added ?? 0} added, ${report.research.verified ?? 0} with a verified email)` : '',
      report.waiting.length ? `\n**Waiting / blocked:**\n${report.waiting.map((x) => `- ${x}`).join('\n')}` : '',
      `\nDaily email limit: ${p.daily_cap || 5}. Sending is ${p.sending_enabled ? (p.auto_send ? 'automatic' : 'on, each email waits for your approval') : 'OFF until you confirm the old ChatGPT automation is off'}.`].filter(Boolean).join('\n');
    await addDocument('career', 'career_report', `Career run ${report.date}`, md, report);
    await say('career', `Career run: ${report.intros.length} new email${report.intros.length === 1 ? '' : 's'}, ${report.followups.length} follow-up${report.followups.length === 1 ? '' : 's'}, ${report.notes.length} LinkedIn note${report.notes.length === 1 ? '' : 's'}, ${report.replies} repl${report.replies === 1 ? 'y' : 'ies'}.`, 'success');
    return report;
  },

  /** One saved job → fit, honest gaps, tailored answers, and the questions only you can answer. */
  async review_job(task) {
    const p = await profile();
    const { data: j } = await db.from('career_jobs').select('*').eq('id', Number(task.input.job_id)).single();
    if (!j) throw new Error('Job not found');
    await db.from('career_jobs').update({ status: 'reviewing', updated_at: now() }).eq('id', j.id);
    const { askJSON } = await import('../lib/claude.js');
    const r = await askJSON({ agentId: 'career', maxTokens: 2500, system: PACKET_SYSTEM,
      prompt: `Resume:\n${p.resume_text}\n\nGoals: ${JSON.stringify(p.goals || {})}\nRules: ${JSON.stringify(p.rules || {})}
The candidate's own answers (use exactly; don't ask again): ${JSON.stringify(known(p))}
Job: ${j.title} at ${j.company} (${j.location || 'location not given'}). Link: ${j.url || 'none'}
${j.posting_text ? `Job description (pasted by the owner):\n${j.posting_text.slice(0, 8000)}` : 'No job description was pasted; base the packet on the title, company and location, and say which details to confirm on the posting.'}` });
    // Your saved answers become ready-to-paste answers; only what's still unknown stays on the "only you can answer" list.
    const a = known(p);
    const defaults = { work_authorized: 'Are you authorized to work in the US?', sponsorship: 'Will you need visa sponsorship now or in the future?', start_date: 'Earliest start date', relocate: 'Willing to relocate / work on-site in this city?', salary: 'Salary expectations (only if the form requires it)', paragon: 'If asked: are you currently employed at Paragon, and the exact dates?' };
    const mine = Object.entries(defaults).filter(([k]) => k in a).map(([k, q]) => ({ q, a: String(yn(a[k])), yours: true }));
    const unknown = Object.entries(defaults).filter(([k]) => !(k in a)).map(([, q]) => q);
    const modelQs = (r.packet?.owner_questions || []).filter((q) => !mine.some((m) => new RegExp(m.q.split(/\W+/).filter((w) => w.length > 5).slice(0, 2).join('|'), 'i').test(q)));
    const packet = { ...(r.packet || {}), answers: [...mine, ...(r.packet?.answers || [])],
      owner_questions: [...new Set([...modelQs, ...unknown, 'Voluntary self-identification answers (gender, race, veteran, disability): your choice'])] };
    await db.from('career_jobs').update({ status: 'packet_ready', track: r.track || j.track, fit: r.fit || null, packet, updated_at: now() }).eq('id', j.id);
    await say('career', `Application packet ready: ${j.title} at ${j.company} (fit ${r.fit?.score ?? '?'}/10${r.fit?.gaps?.length ? `, ${r.fit.gaps.length} gap${r.fit.gaps.length > 1 ? 's' : ''} flagged` : ''}).`, 'success');
    return { job_id: j.id, fit: r.fit?.score };
  },

  /** Web research for relevant people at one company. Emails kept only if they appear word-for-word on the source page. */
  async find_contacts(task) {
    const p = await profile();
    const company = String(task.input.company || '').trim();
    if (!company) throw new Error('No company given');
    const { askJSON } = await import('../lib/claude.js');
    const focus = task.input.focus || p.goals?.company_focus?.[company] || '';
    const r = await askJSON({ agentId: 'career', maxTokens: 3000, webSearches: 6,
      system: `You research professional contacts for a graduate student's job search. Use web search. Prefer campus/university recruiters, recruiting
coordinators, hiring managers and Texas A&M alumni in the relevant team and city. Only include real people you found on a page.
For each person give the page that shows their current role. Include an email ONLY if it appears word-for-word on a public page, and give that
page's URL; never construct or guess an address from a company pattern, and never use masked contact-database results. Return JSON
{"people": [{"name": "...", "title": "...", "location": "...", "profile_source_url": "...", "linkedin_url": "... or null", "email": "... or null", "email_source_url": "... or null", "why": "..."}]} (max 8).`,
      prompt: `Company: ${company}\nFocus: ${focus || 'roles that fit the candidate'}\nCandidate summary: ${String(p.resume_text || '').slice(0, 1500)}\nPreferred locations: ${(p.goals?.locations || []).join(', ')}` });
    let added = 0, verified = 0;
    for (const x of (r.people || []).slice(0, 8)) {
      if (!x?.name) continue;
      const { data: dup } = await db.from('career_contacts').select('id').ilike('name', x.name).ilike('company', company).limit(1);
      if (dup?.length) continue;
      const row = { name: x.name, title: x.title || null, company, location: x.location || null, linkedin_url: x.linkedin_url || null, profile_source_url: x.profile_source_url || null,
        email: x.email ? String(x.email).toLowerCase() : null, email_source: x.email ? 'page' : null, email_source_url: x.email_source_url || null, notes: x.why ? `Why: ${x.why}` : null, priority: 5 };
      if (row.email) { const v = await verifyContact(row); row.email_verified = v.verified; if (!v.verified) { row.notes = `${row.notes || ''} · Email dropped: ${v.why}`; row.email = null; row.email_source = null; } }
      if (row.email_verified) verified++;
      row.channel = row.email ? 'email' : row.linkedin_url ? 'linkedin' : 'none';
      const { error } = await db.from('career_contacts').insert(row);
      if (!error) added++;
    }
    await db.from('career_profile').update({ state: { ...(p.state || {}), researched: { ...(p.state?.researched || {}), [company]: now() } } }).eq('id', 1);
    await say('career', `Contact research at ${company}: ${added} people found, ${verified} with a verified email. The rest get a LinkedIn note for you to send.`, 'info');
    return { added, verified };
  },

  /** Check replies now (also runs every hour on weekdays). */
  async check_replies() { return checkReplies(); },
};
