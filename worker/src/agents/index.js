import { handlers as manager } from './manager.js';
import { handlers as research } from './research.js';
import { handlers as scout } from './scout.js';
import { handlers as inspector } from './inspector.js';
import { handlers as designer } from './designer.js';
import { handlers as postmaster } from './postmaster.js';
import { handlers as merchant } from './merchant.js';
import { handlers as marketer } from './marketer.js';
import { handlers as social } from './social.js';

// agent id → { task kind → handler }
export const registry = {
  manager, research, scout, inspector, designer, postmaster, merchant,
  marketer, social,
};

// What each agent is "doing" in plain words, for the town's status line.
export const verbs = {
  plan: 'Holding a town meeting',
  research: 'Researching',
  find_prospects: 'Scouting for businesses',
  audit_site: 'Inspecting a website',
  design_page: 'Designing a homepage',
  draft_email: 'Writing a letter',
  create_product: 'Drafting a product',
  plan_campaign: 'Planning a campaign',
  write_posts: 'Writing posts',
};
