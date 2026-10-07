// Sample data for the demo. Every name says "Sample" so it can never be mistaken for real activity.
export function seedDemo() {
  const now = Date.now();
  const ago = (m) => new Date(now - m * 60000).toISOString();
  const day = (d) => new Date(now - d * 864e5).toISOString().slice(0, 10);
  const A = (id, name, division, role, status = 'idle', task = null) => ({ id, name, division, role, status, current_task: task, xp: 0, tasks_done: 0, last_seen: ago(0) });
  const agents = [
    A('manager', 'Executive Orchestrator', 'hq', 'Sets priorities, assigns work, enforces budgets'),
    A('risk', 'Risk & Quality', 'hq', 'Watches thresholds and pauses what breaks them'),
    A('scout', 'Local Business Prospecting', 'agency', 'Finds and verifies local businesses', 'working', 'Finding local businesses'),
    A('inspector', 'Lead Qualification', 'agency', 'Audits websites and scores leads'),
    A('designer', 'Website Production', 'agency', 'Builds private previews and client sites'),
    A('qa', 'Quality Assurance', 'agency', 'Checks sites before anything ships'),
    A('postmaster', 'Sales & Follow-up', 'agency', 'Outreach, follow-ups, proposals'),
    A('caller', 'Phone Sales', 'agency', 'Call scripts and consented calls'),
    A('sports', 'Sports Marketing', 'sports', 'Compliant posts from official picks'),
    A('etsy', 'Etsy Product Research', 'etsy', 'Demand, competition, economics'),
    A('merchant', 'Product Design & Listing', 'etsy', 'Original products and listings'),
    A('fulfillment', 'Fulfillment', 'etsy', 'Tracks real orders'),
    A('ds_research', 'Dropship Market Research', 'dropship', 'Dated, observed demand'),
    A('ds_orders', 'Order & Fraud Review', 'dropship', 'Validates and routes orders', 'working', 'Reviewing an order'),
    A('re_underwrite', 'Property Underwriting', 'realestate', 'Value ranges and maximum offer'),
    A('re_deals', 'Offers, Contracts & Diligence', 'realestate', 'Approval-gated offers and deadlines'),
    A('opportunity', 'Opportunity Evaluation', 'ventures', 'Investment memos'),
    A('research', 'Market Research', 'ventures', 'Cited research'),
    A('support', 'Customer Support', 'customers', 'Inbox and escalations'),
    A('finance', 'Finance & Analytics', 'finance', 'Ledger and morning text'),
    A('capital', 'Capital Allocation', 'finance', 'Reserves from collected cash only'),
  ];
  const divisions = [['hq', 'Executive Overview'], ['agency', 'Local Website Agency'], ['sports', 'Sports Platform Marketing'], ['etsy', 'Etsy Commerce'], ['dropship', 'Dropshipping Commerce'],
    ['realestate', 'Real Estate Wholesaling'], ['ventures', 'Market Research & New Ventures'], ['customers', 'Customer Operations'], ['finance', 'Finance & Performance']].map(([id, name], i) => ({ id, name, sort: i }));
  const L = (d, division, category, amount_usd, basis, source) => ({ id: Math.random(), occurred_on: day(d), division, category, amount_usd, basis, source, created_at: ago(d * 1440) });
  const ledger = [
    L(1, 'agency', 'revenue', 400, 'actual', 'stripe (sample)'), L(2, 'agency', 'fees', 11.9, 'estimated', 'stripe estimate'), L(3, 'etsy', 'revenue', 16, 'actual', 'etsy (sample)'),
    L(3, 'etsy', 'fees', 1.77, 'estimated', 'etsy rates'), L(4, 'dropship', 'revenue', 102, 'actual', 'shopify (sample)'), L(4, 'dropship', 'fulfillment', 42, 'estimated', 'supplier quote'),
    L(5, 'dropship', 'ad_spend', 35, 'actual', 'Meta invoice (sample)'), L(6, 'agency', 'revenue', 650, 'forecast', 'proposal sent'), L(8, 'ventures', 'commitment', 25, 'forecast', 'experiment budget'),
  ];
  const usage = Array.from({ length: 40 }, (_, i) => ({ cost_usd: 0.06, created_at: ago(i * 60), agent_id: 'scout', service: 'claude' }));
  const prospects = [
    { id: 1, name: 'Sample Bakery', category: 'Bakery', address: '1 Main St, College Station, TX 77840', phone: '(979) 555-0100', email: 'hello@sample-bakery.test', website: 'http://sample-bakery.test', site_score: 34, lead_score: 81, deal_stage: 'replied', next_step: 'Approve reply', contact_sources: [{ field: 'email', value: 'hello@sample-bakery.test', source: 'their website', observed_at: ago(600) }], audit: { findings: ['Not built for phones', 'No tap-to-call button'], qa: { passed: true, issues: [] } }, last_contacted_at: ago(3000), replied_at: ago(60), updated_at: ago(60) },
    { id: 2, name: 'Sample Auto Care', category: 'Auto repair', address: '2 Texas Ave, Bryan, TX 77803', phone: '(979) 555-0101', website: null, verified_no_website: true, site_score: 0, lead_score: 76, deal_stage: 'qualified', next_step: 'Call (script ready)', contact_sources: [], audit: { findings: ['No website found'] }, updated_at: ago(200) },
    { id: 3, name: 'Sample Salon', category: 'Hair salon', address: '3 Wellborn Rd, College Station, TX', email: 'book@sample-salon.test', website: 'http://sample-salon.test', site_score: 48, lead_score: 66, deal_stage: 'approve_outreach', next_step: 'Approve email', contact_sources: [], audit: { findings: ['Footer says © 2017'] }, updated_at: ago(400) },
    { id: 4, name: 'Sample Dental', category: 'Dentist', address: '4 Southwest Pkwy, College Station, TX', website: 'http://sample-dental.test', site_score: 88, lead_score: 22, deal_stage: 'disqualified', contact_sources: [], audit: { findings: [] }, updated_at: ago(800) },
  ];
  const approvals = [
    { id: 1, agent_id: 'support', kind: 'reply', status: 'pending', title: 'Reply to Sample Bakery: wants pricing', reason: 'They wrote: "What would a new site cost?"', expected_outcome: 'Move toward a proposal', reversible: false, cost_usd: 0, max_exposure_usd: 0, created_at: ago(55), expires_at: new Date(now + 2 * 864e5).toISOString(), payload: { to: 'hello@sample-bakery.test', subject: 'Re: your site', body: 'Thanks for writing back! A one-page mobile site runs $300–$800 depending on what you need...' } },
    { id: 2, agent_id: 'ds_store', kind: 'ds_launch', standing: true, status: 'pending', title: 'Launch "Sample Cable Tray Kit" at $34 (floor $29.40)', reason: 'Base contribution ~$9.10/order (estimate); break-even ad cost $17.60', expected_outcome: 'First orders validate demand', uncertainty: 'Ad costs unknown', scope: 'Auto-fulfill matching orders while margin ≥ 20% and supplier cost ≤ $60', reversible: true, cost_usd: 0, max_exposure_usd: 184, created_at: ago(120), payload: { title: 'Sample Cable Tray Kit', price_usd: 34, rules: { min_margin_pct: 0.2, max_order_cost_usd: 60, price_floor_usd: 29.4 }, economics: { basis: 'estimated', base: { contribution: 9.1, break_even_cac: 17.6 } } } },
    { id: 3, agent_id: 're_deals', kind: 're_offer', status: 'pending', title: 'BINDING OFFER: Sample 12 Pine St at $110,000', reason: 'ARV low $210k − repairs $35k − buyer costs $31k − buyer profit $25k − fee $8k', reversible: false, cost_usd: 0, max_exposure_usd: 0, uncertainty: 'medium confidence; needs inspection', scope: 'Prepare attorney-approved purchase agreement for YOUR signature', created_at: ago(30), payload: { price_usd: 110000, earnest_money_usd: 0 } },
    { id: 4, agent_id: 'sports', kind: 'content', status: 'pending', title: 'X (organic posts): Official pick', reason: 'New official pick on the ledger', reversible: true, cost_usd: 0, max_exposure_usd: 0, created_at: ago(20), payload: { text: 'Sample official pick: Team -3 (-110). Odds as of 6:40 PM CT; lines move.\n\n21+ | Gambling problem? Call 1-800-GAMBLER' } },
  ];
  const workflows = [
    { id: 1, division: 'agency', kind: 'agency_lead', objective: 'Win Sample Bakery as a website client', stage: 'contact', status: 'waiting_approval', owner_agent: 'postmaster', subject_type: 'prospect', subject_id: 1, next_action: 'Approve the reply', cost_usd: 0.42, budget_usd: 1.5, evidence: [], updated_at: ago(60) },
    { id: 2, division: 'realestate', kind: 're_deal', objective: 'Evaluate Sample 12 Pine St', stage: 'offer_review', status: 'waiting_approval', owner_agent: 're_deals', subject_type: 're_deal', subject_id: 1, next_action: 'Owner decides on the offer', cost_usd: 0.9, budget_usd: 0, evidence: [], updated_at: ago(30) },
    { id: 3, division: 'dropship', kind: 'ds_niche', objective: 'Validate niche: Sample desk organization', stage: 'launch_approval', status: 'waiting_approval', owner_agent: 'ds_store', next_action: 'Owner approves launch', cost_usd: 1.2, budget_usd: 0, evidence: [], updated_at: ago(120) },
    { id: 4, division: 'etsy', kind: 'etsy_product', objective: 'Launch "Sample Pet Mug"', stage: 'sample', status: 'blocked', owner_agent: 'merchant', blockers: 'Print-on-demand sample not approved', recovery: 'Order a sample and mark it approved in Etsy Commerce', cost_usd: 0.3, budget_usd: 3, evidence: [], updated_at: ago(3000) },
  ];
  return {
    agents, divisions, ledger, usage, prospects, approvals, workflows,
    events: [{ id: 1, agent_id: 'manager', level: 'success', message: 'Sample: Focus today: agency replies and the dropship launch decision.', created_at: ago(5) }],
    workflow_events: [{ id: 1, workflow_id: 1, agent_id: 'support', type: 'result', message: 'Reply received (interested): Wants pricing', created_at: ago(60) }],
    integrations: [
      { id: 'gmail', name: 'Email (agentickj@gmail.com)', status: 'needs_setup', detail: 'Waiting for SMTP_PASS', checked_at: ago(1) },
      { id: 'twilio', name: 'Twilio SMS', status: 'needs_setup', detail: 'No Twilio credentials yet', checked_at: ago(1) },
      { id: 'shopify', name: 'Shopify (dropshipping store)', status: 'needs_setup', detail: 'Store not connected', checked_at: ago(1) },
      { id: 'anthropic', name: 'Claude API', status: 'connected', detail: 'API key accepted', checked_at: ago(1) },
      { id: 'ai_calling', name: 'AI phone calls', status: 'disabled', detail: 'Off without written consent', checked_at: ago(1) },
    ],
    outreach_messages: [], call_tasks: [{ id: 1, prospect_id: 2, mode: 'manual', status: 'ready', phone: '(979) 555-0101', objective: 'Book a short meeting', eligibility: { ai_allowed: false, reasons: ['No written consent'], calling_hours: 'Weekdays 9–5' }, script: 'Hi, this is Keck with KJ Agentic...', created_at: ago(100) }],
    projects: [{ id: 1, title: 'Sample Taco Shop website', price_usd: 650, status: 'awaiting_payment', prospect_id: 9, created_at: ago(900) }],
    invoices: [{ id: 1, project_id: 1, amount_usd: 325, status: 'sent', url: null }], customers: [],
    conversations: [{ id: 1, prospect_id: 1, subject: 'Re: your site', status: 'waiting_on_us', summary: 'Wants pricing', last_message_at: ago(60) }],
    messages: [{ id: 1, conversation_id: 1, direction: 'in', sender: 'hello@sample-bakery.test', body: 'What would a new site cost?', classification: 'interested', created_at: ago(60) }],
    sms_messages: [], notify_settings: [{ id: 1, phone: '+19403661992', timezone: 'America/Chicago', digest_time: '07:30', digest_enabled: true, urgent_alerts: false, paused: false }],
    settings: [{ id: 1, paused: false, weekly_goal: 2000, daily_budget_usd: 5, daily_email_cap: 15, daily_prospect_cap: 40, outreach_areas: ['College Station, TX', 'Bryan, TX'], outreach_categories: ['bakery', 'hair salon', 'auto repair'], outreach_offer: 'A new mobile-friendly site at a low local introductory rate.', agency_pricing: { landing_page: { min: 300, max: 800 } }, dropship_rules: { min_margin_pct: 0.2, max_order_cost_usd: 60, max_test_ad_budget_usd: 100, hold_high_value_usd: 150 } }],
    sports_snapshots: [{ fetched_at: ago(30), stale: false, official_stats: { ALL: { record: '3-2', units: 1.77 } } }],
    sports_picks: [{ id: 'p1', league: 'NCAA', pick: 'Sample Team -3', odds: '-110', kickoff: new Date(now + 864e5).toISOString(), odds_as_of: ago(25), status: 'UPCOMING' }],
    content_items: [{ id: 1, division: 'sports', channel: 'sports_x', body: 'Sample official pick post…', status: 'pending_approval', created_at: ago(20) }],
    channels: [{ id: 'sports_x', division: 'sports', name: 'X (organic posts)', enabled: true, policy_verified_at: ago(2000), policy_notes: 'Sample: organic posts allowed with 21+ notice', requirements: { age_gate: '21+' } }, { id: 'sports_meta_ads', division: 'sports', name: 'Meta paid ads', enabled: false, requirements: { blocked_until: 'Meta prior written permission' } }],
    products: [{ id: 1, title: 'Sample Budget Planner', stage: 'listed', fulfillment_model: 'digital', economics: { base: { contribution: 6.4 } }, concept: { evidence_quality: 'moderate' } }, { id: 2, title: 'Sample Pet Mug', stage: 'concept', fulfillment_model: 'print_on_demand', sample_status: 'needed', economics: { base: { contribution: 4.1 } } }],
    orders: [{ id: 1, division: 'etsy', external_id: 'etsy:sample1', amount_usd: 8, status: 'delivered', created_at: ago(4000) }, { id: 2, division: 'dropship', external_id: 'shopify:sample1043', amount_usd: 34, status: 'fulfilling', cost_usd: 14, data: { next: 'Place this order with Sample Supplier' }, created_at: ago(300) }, { id: 3, division: 'dropship', external_id: 'shopify:sample1044', amount_usd: 400, status: 'exception', data: { holds: ['High-value order: review for fraud'] }, created_at: ago(200) }],
    ds_products: [{ id: 1, title: 'Sample Cable Tray Kit', niche: 'Desk organization', stage: 'approval', scores: { total: 74 }, flags: {}, recommendation: 'test', sample_status: 'approved', economics: { base: { contribution: 9.1, break_even_cac: 17.6 } } }, { id: 2, title: 'Sample Collagen Gummies', niche: 'Desk organization', stage: 'rejected', scores: { total: 40 }, flags: { restricted: true, needs_health_or_safety_claims: true }, recommendation: 'do_not_launch', sample_status: 'needed' }],
    suppliers: [{ id: 1, name: 'Sample Supplier (TX warehouse)', warehouses: ['TX'], processing_days: 1, shipping_days: { min: 2, max: 5 }, tracking: true, status: 'verified' }],
    supplier_quotes: [],
    re_jurisdictions: [{ id: 'TX', name: 'Texas (Bryan / College Station first)', status: 'research_only', requirements: { equitable_interest: { rule: 'Occ. Code §1101.0045: written disclosure to buyers when selling an equitable interest.', source: 'SB 2212 (2017)' }, seller_disclosure: { rule: 'Since Jan 1, 2024 (SB 1577) also to sellers.', source: 'SB 1577' }, needs_attorney: 'Templates need Texas attorney review.' }, approved_templates: [] }],
    properties: [{ id: 1, address: 'Sample 12 Pine St, Bryan, TX 77803', owner: { name: 'Sample Owner', source: 'county records (sample)' }, facts: { beds: { value: 3 }, sqft: { value: 1400 } } }],
    re_deals: [{ id: 1, property_id: 1, stage: 'offer_review', max_offer_usd: 110000, fee_estimate_usd: 8000, underwriting: { arv_range: { low: 210000, base: 230000, high: 245000, confidence: 'medium' }, max_offer: { formula: 'sample formula' }, comps: [{ address: 'Sample 5 Oak', price: 235000, price_type: 'asking price', sqft: 1450, distance_mi: 0.4 }], data_note: 'Listing prices, not closed sales (Texas non-disclosure).' }, updated_at: ago(30) }],
    deadlines: [{ id: 1, subject_type: 're_deal', subject_id: 3, kind: 'option_period', due_at: new Date(now + 2 * 864e5).toISOString(), status: 'open' }],
    buyers: [{ id: 1, name: 'Sample Investor LLC', criteria: { areas: ['77803'], max_price: 150000 }, consent: { how: 'web form opt-in', when: day(10) }, status: 'active' }],
    deal_documents: [], authorities: [{ id: 1, kind: 'email_campaign', title: 'Sample: BCS bakeries pilot', status: 'active', rules: { areas: ['College Station, TX'], categories: ['bakery'], include_followups: true }, daily_limit: 5, budget_usd: 0, spent_usd: 0 }],
    opportunities: [{ id: 1, title: 'Sample: Google Business Profile setup service', status: 'proposed', scores: { total: 75, demand_evidence: 4, startup_cost: 5 }, memo: '## Sample memo\n**What / who:** GBP setup for local shops.\n**Experiment (14 days, max $25):** pitch 20 businesses.' }],
    experiments: [{ id: 1, title: 'Sample: organic TikTok for cable kit', hypothesis: '5 orders in 14 days from organic posts', budget_usd: 50, spent_usd: 0, min_sample: 30, status: 'designed' }],
    documents: [{ id: 1, agent_id: 'manager', kind: 'manager_plan', title: 'Sample town meeting', body: '**Focus:** agency replies, dropship launch decision.', created_at: ago(5) }],
    campaigns: [], suppression: [], cash_reserves: [{ id: 'refunds', description: 'Refunds and chargebacks reserve', amount_usd: 50 }, { id: 'operating', description: 'Operating expenses (30 days)', amount_usd: 100 }],
    risk_thresholds: [], tasks: [], commands: [],
  };
}
