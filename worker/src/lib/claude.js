import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { db, getSettings, startOfToday } from './db.js';

const client = new Anthropic({ apiKey: config.anthropicKey });

export class BudgetExceeded extends Error {}

export async function spentToday() {
  const { data, error } = await db.from('usage').select('cost_usd').gte('created_at', startOfToday());
  if (error) throw new Error(error.message);
  return (data || []).reduce((s, r) => s + Number(r.cost_usd || 0), 0);
}

export async function checkBudget() {
  const settings = await getSettings();
  const spent = await spentToday();
  if (spent >= Number(settings.daily_budget_usd)) {
    throw new BudgetExceeded(`Daily budget of $${settings.daily_budget_usd} reached ($${spent.toFixed(2)} spent). Agents resume tomorrow.`);
  }
  return { spent, budget: Number(settings.daily_budget_usd) };
}

/**
 * Ask Claude something. Logs cost automatically.
 * @param {object} o
 * @param {string} o.agentId
 * @param {string} o.system
 * @param {string} o.prompt
 * @param {boolean} [o.cheap]      use the cheaper model
 * @param {number}  [o.maxTokens]
 * @param {number}  [o.webSearches] allow up to N web searches (0 = none)
 * @returns {Promise<string>} the text answer
 */
export async function ask({ agentId, system, prompt, cheap = false, maxTokens = 4000, webSearches = 0 }) {
  await checkBudget();
  const model = cheap ? config.cheapModel : config.model;
  const tools = webSearches > 0
    ? [{ type: 'web_search_20250305', name: 'web_search', max_uses: webSearches }]
    : undefined;

  let messages = [{ role: 'user', content: prompt }];
  let text = '';
  let inTok = 0, outTok = 0, searches = 0;

  // Server-side tools can pause a long turn ("pause_turn"); continue it a few times.
  for (let round = 0; round < 4; round++) {
    const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages, ...(tools ? { tools } : {}) });
    inTok += res.usage?.input_tokens || 0;
    outTok += res.usage?.output_tokens || 0;
    searches += res.usage?.server_tool_use?.web_search_requests || 0;
    text += res.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    if (res.stop_reason !== 'pause_turn') break;
    messages = [...messages, { role: 'assistant', content: res.content }];
  }

  const price = config.prices[model] || config.prices.default;
  const cost = (inTok / 1e6) * price.in + (outTok / 1e6) * price.out + searches * config.webSearchPrice;
  await db.from('usage').insert({
    agent_id: agentId, service: 'claude', cost_usd: cost,
    units: { model, input_tokens: inTok, output_tokens: outTok, web_searches: searches },
  });
  return text.trim();
}

/** Ask Claude for JSON and parse it. */
export async function askJSON(opts) {
  const text = await ask({
    ...opts,
    prompt: `${opts.prompt}\n\nRespond with ONLY valid JSON, no commentary and no code fences.`,
  });
  return parseJSON(text);
}

export function parseJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned); } catch {}
  // Fall back to the first {...} or [...] block in the text.
  const start = cleaned.search(/[\[{]/);
  const end = Math.max(cleaned.lastIndexOf('}'), cleaned.lastIndexOf(']'));
  if (start >= 0 && end > start) return JSON.parse(cleaned.slice(start, end + 1));
  throw new Error('Claude did not return valid JSON');
}
