// Postmaster Pete: drafts a short, honest outreach email for each designed prospect.
// Emails go into your approval inbox. Nothing is sent until you approve it.
import { config } from '../config.js';
import { db, must, say, getSettings, requestApproval } from '../lib/db.js';
import { askJSON } from '../lib/claude.js';
import { legalFooter } from '../lib/mailer.js';

const SYSTEM = `You write short cold emails from a local web designer to small-business owners.
Tone: friendly neighbor, plain language, zero hype. 80-130 words. No exclamation-heavy sales talk.
Structure: who you are (local), one or two specific problems you noticed on their current site (or that they have no site),
that you already made a free concept of a new homepage (attached as a before/after image), the offer, and a low-pressure ask
(a 10-minute call or a reply). Never invent facts, statistics, or results. Never claim to be a customer.
Subject line: under 7 words, specific to their business, not clickbait, no ALL CAPS.
Do NOT include a signature or footer; it is added automatically.`;

export const handlers = {
  async draft_email(task) {
    const p = must(await db.from('prospects').select('*').eq('id', task.input.prospect_id).single());
    const settings = await getSettings();

    if (p.email) {
      const { data: blocked } = await db.from('suppression').select('email').eq('email', p.email.toLowerCase()).maybeSingle();
      if (blocked) {
        await db.from('prospects').update({ stage: 'lost', notes: 'On do-not-contact list' }).eq('id', p.id);
        await say('postmaster', `${p.name} asked not to be contacted. Skipping.`, 'warn');
        return { skipped: 'suppressed' };
      }
    }

    await say('postmaster', `Writing a note to ${p.name}...`);
    const draft = await askJSON({
      agentId: 'postmaster', system: SYSTEM, cheap: true, maxTokens: 1200,
      prompt: `Sender: ${config.business.senderName || '[your name]'} from ${config.business.name || '[your business]'}, based in ${settings.outreach_city}.
Offer: ${settings.outreach_offer}
Business: ${p.name} (${p.category}), ${p.address}
Their site: ${p.website || 'none'}
Problems found: ${JSON.stringify(p.audit?.findings || [])}
Return JSON: {"subject": "...", "body": "..."} where body starts with a greeting like "Hi there," (we don't know the owner's name).`,
    });

    const body = `${draft.body.trim()}\n${legalFooter()}`;
    await requestApproval({
      agentId: 'postmaster',
      kind: 'email',
      title: p.email ? `Email to ${p.name}` : `Email to ${p.name} (no email found; add one or call ${p.phone || 'them'})`,
      prospectId: p.id,
      preview: p.comparison,
      payload: { to: p.email || '', subject: draft.subject, body, attachment: p.comparison, phone: p.phone, website: p.website },
    });
    await db.from('prospects').update({ stage: 'drafted', updated_at: new Date().toISOString() }).eq('id', p.id);
    await say('postmaster', `Letter to ${p.name} is waiting for your stamp in the approval inbox.`, 'success');
    return { prospect: p.name, subject: draft.subject, has_email: !!p.email };
  },
};
