import { handlers as manager } from './manager.js';
import { handlers as research } from './research.js';
import { handlers as scout } from './scout.js';
import { handlers as inspector } from './inspector.js';
import { handlers as designer } from './designer.js';
import { handlers as postmaster } from './postmaster.js';
import { handlers as merchantLegacy } from './merchant.js';
import { handlers as marketer } from './marketer.js';
import { handlers as social } from './social.js';
import { handlers as qa } from './qa.js';
import { handlers as support } from './support.js';
import { handlers as caller } from './caller.js';
import { handlers as finance } from './finance.js';
import { handlers as etsy, merchantHandlers } from './etsy.js';
import { handlers as fulfillment } from './fulfillment.js';
import { handlers as sports } from './sports.js';
import { handlers as opportunity } from './opportunity.js';
import { handlers as dropship } from './dropship.js';
import { handlers as realestate } from './realestate.js';
import { handlers as shared } from './shared.js';

// agent id → { task kind → handler }
export const registry = {
  manager, research, scout, inspector, designer, postmaster, marketer, social, qa, support, caller, finance,
  etsy, fulfillment, sports, opportunity,
  merchant: { ...merchantLegacy, ...merchantHandlers },
  ds_research: dropship, ds_product: dropship, ds_supplier: dropship, ds_store: dropship, ds_orders: dropship,
  re_market: realestate, re_leads: realestate, re_underwrite: realestate, re_deals: realestate, re_buyers: realestate,
  experiments: shared, learning: shared, capital: shared, risk: shared, improve: shared,
};

// What each agent is doing, in plain words (shown in the live feed and the "why" panel).
export const verbs = {
  plan: 'Reviewing all divisions and assigning work',
  research: 'Researching a market question with cited sources',
  find_prospects: 'Finding local businesses',
  audit_site: 'Verifying and auditing a business website',
  design_page: 'Building a private website preview',
  check_site: 'Quality-checking a website preview',
  draft_email: 'Drafting outreach',
  run_followups: 'Checking who needs a follow-up',
  draft_proposal: 'Drafting a proposal',
  process_inbox: 'Reading new replies',
  prepare_call: 'Preparing a call script',
  record_outcome: 'Filing a call report',
  create_product: 'Drafting a product',
  build_digital_product: 'Producing a digital product and listing',
  research_products: 'Researching Etsy demand and economics',
  sync_orders: 'Syncing orders and shipments',
  sync_picks: 'Importing official picks',
  draft_content: 'Drafting sports marketing posts',
  propose_opportunities: 'Writing opportunity memos',
  plan_campaign: 'Planning a campaign',
  write_posts: 'Writing posts',
  send_test_text: 'Sending a test text',
  daily_rollup: 'Closing yesterday\'s books',
  research_niches: 'Researching dropshipping niches',
  evaluate_product: 'Scoring a product and its risks',
  find_suppliers: 'Verifying suppliers',
  build_listing: 'Building a product page',
  review_order: 'Reviewing an order',
  sync_shopify_orders: 'Checking tracking',
  market_report: 'Reading the local real estate market',
  import_leads: 'Importing property leads',
  underwrite: 'Underwriting a property',
  plan_outreach: 'Preparing seller outreach',
  prepare_offer: 'Preparing an offer for approval',
  match_buyers: 'Matching opt-in buyers',
  check_risks: 'Checking risk thresholds',
  allocation_report: 'Reviewing available cash',
  weekly_learning: 'Learning from results',
  design_experiment: 'Designing an experiment',
  find_bottlenecks: 'Looking for bottlenecks',
};
