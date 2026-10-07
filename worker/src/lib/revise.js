// "Request changes" → the agent revises right away and puts the card back in front of you.
// Picked up by the fast lane within ~3 seconds; most revisions take 5-20 seconds.
// Guardrails: money and limits can't drift. A number (price, budget, deposit…) only changes if your note says that number.
import { db, say, upload, download } from './db.js';
import { logEvent } from './workflows.js';

const TEXT_KEYS = ['subject', 'body', 'text', 'title', 'description', 'letter', 'caption', 'memo'];
const now = () => new Date().toISOString();

/** Revise every card you sent back. Returns how many were revised. */
export async function reviseRequested() {
  const { data, error } = await db.from('approvals').select('*').eq('status', 'changes_requested').order('decided_at').limit(5);
  if (error || !data?.length) return 0;
  let n = 0;
  await Promise.all(data.map(async (a) => {
    // Claim it (so two runs never revise the same card twice).
    const { data: claimed } = await db.from('approvals').update({ status: 'revising', result: { ...(a.result || {}), revising_since: now() } }).eq('id', a.id).eq('status', 'changes_requested').select();
    if (!claimed?.length) return;
    const t0 = Date.now();
    const note = String(a.decision_note || '').replace(/\s*\[edited after approval: needs re-approval\]/g, '').trim();
    try {
      let patch;
      if (a.kind === 'site_publish') patch = await reviseSite(a, note);
      else if (a.kind === 'project_plan') patch = await revisePlan(a, note);
      else patch = await reviseText(a, note);
      const revisions = [...(a.result?.revisions || []), { note, at: now(), seconds: Math.round((Date.now() - t0) / 1000) }].slice(-10);
      await db.from('approvals').update({ ...patch, status: 'pending', result: { revisions, note: `Revised per your note (${Math.round((Date.now() - t0) / 1000)}s): "${note.slice(0, 160)}"` } }).eq('id', a.id);
      await logEvent(a.workflow_id, a.agent_id, 'note', `Revised "${a.title}" per your note: ${note.slice(0, 200)}`);
      await say(a.agent_id || 'manager', `Revised "${a.title.slice(0, 60)}" per your note. It's back in Approvals.`, 'success');
      n++;
    } catch (e) {
      await db.from('approvals').update({ status: 'changes_requested', result: { ...(a.result || {}), revise_error: String(e.message).slice(0, 200) } }).eq('id', a.id);
      console.error('revise:', e.message);
    }
  }));
  return n;
}

/** Text cards (emails, replies, proposals, posts, listings, letters…): rewrite the words; keep the numbers unless you named one. */
async function reviseText(a, note) {
  const { askJSON } = await import('./claude.js');
  const p = a.payload || {};
  const editable = Object.fromEntries(Object.entries(p).filter(([k, v]) => TEXT_KEYS.includes(k) && typeof v === 'string'));
  const numbers = Object.fromEntries(Object.entries(p).filter(([, v]) => typeof v === 'number'));
  if (!Object.keys(editable).length && !Object.keys(numbers).length) throw new Error('Nothing on this card can be revised automatically. Edit it directly, or reject it.');
  const r = await askJSON({ agentId: a.agent_id || 'manager', cheap: true, maxTokens: 2500,
    system: `You revise a draft exactly as the business owner asked. Keep everything they didn't ask to change. Never add facts, prices, promises,
reviews or claims that aren't already in the draft or in the owner's note. Keep any legal footer (address, unsubscribe line, 21+ notices) intact.
Return JSON with the same keys you were given (text fields) plus "numbers" for any numeric field the owner explicitly asked to change.`,
    prompt: `Card: ${a.title}\nOwner's change request: """${note}"""\n\nText fields (JSON): ${JSON.stringify(editable)}\nNumeric fields (only change if the note says so): ${JSON.stringify(numbers)}` });
  const payload = { ...p };
  for (const k of Object.keys(editable)) if (typeof r[k] === 'string' && r[k].trim()) payload[k] = r[k];
  // A number may only change to a value written in your note.
  for (const [k, v] of Object.entries(r.numbers || {})) {
    if (k in numbers && Number.isFinite(Number(v)) && note.replace(/,/g, '').includes(String(Number(v)))) payload[k] = Number(v);
  }
  return { payload };
}

/** Landing page drafts: edit the page itself, take a new preview. */
async function reviseSite(a, note) {
  const { ask } = await import('./claude.js');
  const { screenshotHtml, PHONE } = await import('./browser.js');
  const { data: site } = await db.from('sites').select('*').eq('id', a.payload.site_id).single();
  const html = (await download(site.html_path)).toString('utf-8');
  const out = await ask({ agentId: 'designer', maxTokens: 7000,
    system: 'You edit an existing one-page HTML website exactly as the owner asked. Return the COMPLETE updated HTML document only. Keep all rules: no invented prices, reviews, testimonials or claims; no JavaScript; no "#" links; keep the footer.',
    prompt: `Owner's change request: """${note}"""\n\nCurrent HTML:\n${html}` });
  const clean = out.replace(/^```html?\s*|```\s*$/g, '').trim();
  if (!/<html/i.test(clean)) throw new Error('The revised page came back incomplete.');
  const v = (a.result?.revisions || []).length + 2;
  const htmlPath = await upload(`sites/${site.slug}/index.html`, clean, 'text/html');
  await upload(`sites/${site.slug}/v${v}.html`, clean, 'text/html');
  const shot = await screenshotHtml(clean, PHONE, true).catch(() => null);
  const previewPath = shot ? await upload(`sites/${site.slug}/preview-v${v}.jpg`, shot, 'image/jpeg') : site.preview_path;
  await db.from('sites').update({ html_path: htmlPath, preview_path: previewPath, updated_at: now() }).eq('id', site.id);
  return { preview: previewPath, payload: { ...a.payload, version: v } };
}

/** Project plans: re-plan with your note, same card. */
async function revisePlan(a, note) {
  const { replanIdea } = await import('./collab.js');
  const steps = await replanIdea(a, note);
  return { payload: steps.payload, title: steps.title, expected_outcome: steps.expected_outcome };
}
