// Barker Ben: plans marketing campaigns and hands post ideas to the Town Crier.
import { db, say, addDocument, enqueue, getSettings } from '../lib/db.js';
import { askJSON } from '../lib/claude.js';

const SYSTEM = `You are a scrappy marketer for a one-person business with almost no ad budget.
Favor free and organic channels (local Facebook groups, Google Business Profile, Nextdoor, Instagram, TikTok, LinkedIn, Reddit
where self-promotion is allowed, partnerships). Respect each platform's rules about promotion. Be specific and measurable.`;

export const handlers = {
  async plan_campaign(task) {
    const settings = await getSettings();
    const { data: products } = await db.from('documents').select('title').eq('kind', 'product')
      .order('created_at', { ascending: false }).limit(5);
    await say('marketer', 'Painting a new campaign on the billboard...');
    const plan = await askJSON({
      agentId: 'marketer', system: SYSTEM, maxTokens: 3500,
      prompt: `Business focus: ${settings.business_focus}
City: ${settings.outreach_city}
Weekly revenue goal: $${settings.weekly_goal}
Products so far: ${(products || []).map((p) => p.title).join('; ') || 'none yet'}
Campaign focus requested: ${task.input.focus || 'whatever will bring in paying customers fastest'}

Return JSON: {"name": "...", "goal": "...", "audience": "...", "channels": [{"channel": "...", "tactic": "...", "weekly_actions": "..."}],
"key_messages": ["..."], "success_metric": "...", "social_themes": ["3 to 5 post themes"]}`,
    });

    const md = [`# ${plan.name}`, `**Goal:** ${plan.goal}`, `**Audience:** ${plan.audience}`, '## Channels',
      ...plan.channels.map((c) => `- **${c.channel}**: ${c.tactic} (${c.weekly_actions})`),
      '## Key messages', ...plan.key_messages.map((m) => `- ${m}`), `**Success metric:** ${plan.success_metric}`].join('\n');
    const doc = await addDocument('marketer', 'campaign', plan.name, md, plan);

    for (const theme of (plan.social_themes || []).slice(0, 3)) {
      await enqueue('social', 'write_posts', { theme, campaign: plan.name, count: 2 }, { createdBy: 'marketer' });
    }
    await say('marketer', `Campaign "${plan.name}" is up. Sent ${Math.min(3, plan.social_themes?.length || 0)} post themes to the Town Crier.`, 'success');
    return { document_id: doc.id, name: plan.name };
  },
};
