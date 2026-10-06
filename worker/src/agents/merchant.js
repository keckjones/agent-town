// Merchant Mo: turns research into product listings and sends them for your approval.
import { db, say, addDocument, getSettings, requestApproval } from '../lib/db.js';
import { askJSON } from '../lib/claude.js';

const SYSTEM = `You create product listings for a solo online seller, mostly digital products (templates, guides, planners, checklists)
that can be produced quickly. Listings must be honest: no fake scarcity, no invented reviews, no income or health claims,
no other brands' trademarks. Write for real buyers, with clear benefits and exactly what they receive.`;

export const handlers = {
  async create_product(task) {
    const settings = await getSettings();
    const { data: reports } = await db.from('documents').select('title, body').eq('kind', 'research_report')
      .order('created_at', { ascending: false }).limit(2);
    const context = (reports || []).map((r) => `## ${r.title}\n${(r.body || '').slice(0, 3500)}`).join('\n\n');

    await say('merchant', 'Stocking the shelves: drafting a new product listing...');
    const p = await askJSON({
      agentId: 'merchant', system: SYSTEM, maxTokens: 3000,
      prompt: `Business focus: ${settings.business_focus}
Idea to develop (may be empty): ${task.input.idea || ''}
Recent research:\n${context || '(none yet)'}

Return JSON: {"title": "...", "price_usd": number, "short_description": "...", "description": "...(HTML allowed: <p>, <ul>, <li>, <strong>)",
"tags": ["..."], "platform_suggestion": "Shopify | Etsy | Gumroad", "what_buyer_gets": ["..."],
"production_outline": ["steps to actually create the product"], "why_it_should_sell": "..."}`,
    });

    const doc = await addDocument('merchant', 'product', p.title, p.description, p);
    await requestApproval({
      agentId: 'merchant', kind: 'product', title: `New listing: ${p.title} ($${p.price_usd})`,
      payload: { ...p, document_id: doc.id },
    });
    await say('merchant', `Listing "${p.title}" is waiting for your approval.`, 'success');
    return { title: p.title, price: p.price_usd };
  },
};
