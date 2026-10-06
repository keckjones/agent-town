// Crier Cleo: writes social media posts. Each post goes to your approval inbox;
// once approved it's ready to copy and post (or to auto-publish when you connect a platform later).
import { say, addDocument, getSettings, requestApproval } from '../lib/db.js';
import { askJSON } from '../lib/claude.js';

const SYSTEM = `You write social media posts for a small local business owner. Sound like a real person, not a brand bot.
Match each platform's style and length. No fake testimonials, no invented stats, no engagement bait, at most 3 hashtags.`;

export const handlers = {
  async write_posts(task) {
    const settings = await getSettings();
    const count = Math.min(task.input.count || 3, 5);
    await say('social', `Hear ye! Drafting ${count} posts about "${(task.input.theme || 'our services').slice(0, 50)}"`);
    const out = await askJSON({
      agentId: 'social', system: SYSTEM, cheap: true, maxTokens: 2500,
      prompt: `Business: ${settings.business_focus}
City: ${settings.outreach_city}
Campaign: ${task.input.campaign || 'general'}
Theme: ${task.input.theme || 'what we do and who we help'}
Platforms to choose from: ${(task.input.platforms || ['Facebook', 'Instagram', 'LinkedIn', 'TikTok caption']).join(', ')}

Write ${count} posts. Return JSON: {"posts": [{"platform": "...", "text": "...", "image_idea": "...", "best_time": "e.g. Tue 11am"}]}`,
    });

    for (const post of out.posts.slice(0, count)) {
      await addDocument('social', 'social_post', `${post.platform}: ${post.text.slice(0, 60)}`, post.text, post);
      await requestApproval({ agentId: 'social', kind: 'social_post', title: `${post.platform} post`, payload: post });
    }
    await say('social', `${out.posts.length} posts are waiting for your approval.`, 'success');
    return { posts: out.posts.length };
  },
};
