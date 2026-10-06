// Librarian Lou: market research with live web search. Writes reports to the Library.
import { say, addDocument, getSettings } from '../lib/db.js';
import { ask } from '../lib/claude.js';

const SYSTEM = `You are a practical market researcher for a one-person online business.
Use web search to ground every claim in current sources. Be concrete: name real platforms, real price ranges you found,
real competitors, and demand signals. Flag anything you could not verify. Prefer opportunities a solo founder can test within
two weeks for under $100. Write in clear Markdown with short sections, and end with "Recommended next steps" (3-5 bullets)
and a "Sources" list of URLs.`;

export const handlers = {
  async research(task) {
    const settings = await getSettings();
    const topic = task.input.topic || `Best opportunities right now for: ${settings.business_focus}`;
    await say('research', `Hitting the books on: ${topic.slice(0, 90)}`);
    const report = await ask({
      agentId: 'research', system: SYSTEM, webSearches: task.input.searches || 6, maxTokens: 6000,
      prompt: `Business focus: ${settings.business_focus}\nLocal market: ${settings.outreach_city}\n\nResearch question: ${topic}`,
    });
    const doc = await addDocument('research', 'research_report', topic.slice(0, 120), report);
    await say('research', `New report shelved in the Library: "${topic.slice(0, 60)}"`, 'success');
    return { document_id: doc.id, chars: report.length };
  },
};
