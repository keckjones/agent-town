-- =====================================================================
-- Migration 003: Dropshipping + Real Estate Wholesaling + shared improvement agents
-- Run AFTER 002_command_center.sql. Additive only. Safe to run again.
-- =====================================================================

insert into divisions (id, name, description, sort) values
  ('dropship',   'Dropshipping Commerce',            'Research-to-reconciliation store with supplier verification', 8),
  ('realestate', 'Real Estate Wholesaling',          'Seller leads, underwriting, contracts and assignments (professional review required)', 9)
on conflict (id) do update set name = excluded.name, description = excluded.description, sort = excluded.sort;

insert into agents (id, name, building, role, division) values
  ('ds_research',   'Dropship Market Research',        'dropship',   'Finds niches with dated, observed demand',                 'dropship'),
  ('ds_product',    'Product Evaluation',              'dropship',   'Scores products and flags risky ones',                     'dropship'),
  ('ds_supplier',   'Supplier Verification',           'dropship',   'Verifies suppliers, costs, shipping and samples',          'dropship'),
  ('ds_store',      'Store & Merchandising',           'dropship',   'Builds accurate product pages and policies',               'dropship'),
  ('ds_orders',     'Order & Fraud Review',            'dropship',   'Validates, holds or routes each paid order',               'dropship'),
  ('re_market',     'Market Intelligence',             'realestate', 'Tracks local supply, pricing and investor demand',         'realestate'),
  ('re_leads',      'Seller Lead Research',            'realestate', 'Verifies properties, owners and sources',                  'realestate'),
  ('re_underwrite', 'Property Underwriting',           'realestate', 'Value ranges, repairs, and maximum offer',                 'realestate'),
  ('re_deals',      'Offers, Contracts & Diligence',   'realestate', 'Prepares offers and tracks deadlines (approval required)', 'realestate'),
  ('re_buyers',     'Buyer Network & Disposition',     'realestate', 'Opt-in investor CRM and deal packages',                    'realestate'),
  ('experiments',   'Experiment Design',               'hq',         'Hypotheses, budgets, success and stop rules',              'hq'),
  ('learning',      'Performance Learning',            'finance',    'What actually produces collected profit',                  'finance'),
  ('capital',       'Capital Allocation',              'finance',    'Reserves and budgets from collected cash only',            'finance'),
  ('risk',          'Risk & Quality',                  'hq',         'Watches thresholds and pauses what breaks them',           'hq'),
  ('improve',       'Workflow Improvement',            'hq',         'Finds bottlenecks; proposes, never self-approves',         'hq')
on conflict (id) do nothing;

-- ---------------- Dropshipping ----------------
create table if not exists ds_products (
  id              bigint generated always as identity primary key,
  niche           text,
  title           text not null,
  stage           text not null default 'candidate', -- candidate | rejected | supplier_check | sample | economics | approval | listed | paused | retired
  scores          jsonb,          -- demand, differentiation, margin, shipping, returns, supplier, support (1-5) + total
  flags           jsonb,          -- fragile, counterfeit_risk, restricted, recall, liability, health_claims
  evidence        jsonb,          -- observed facts with sources + dates
  estimates       jsonb,
  recommendation  text,           -- launch | test | do_not_launch
  economics       jsonb,
  price_floor_usd numeric,
  supplier_id     bigint,
  backup_supplier_id bigint,
  sample_status   text not null default 'needed',  -- needed | requested | received | approved | rejected
  store_product_id text,
  policies        jsonb,
  paused_reason   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists suppliers (
  id               bigint generated always as identity primary key,
  name             text not null,
  website          text,
  contact_email    text,
  identity_checks  jsonb,         -- business registration, address, years active (with sources)
  warehouses       text[],
  ships_to         text[],
  processing_days  numeric,
  shipping_days    jsonb,         -- {min, max} to US
  tracking         boolean,
  returns_policy   text,
  responsiveness_hours numeric,
  integration      text,          -- manual | shopify_app | api
  status           text not null default 'unverified', -- unverified | verifying | verified | rejected | suspended
  performance      jsonb,         -- on_time_rate, defect_rate, avg_ship_days (from real orders)
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create table if not exists supplier_quotes (
  id              bigint generated always as identity primary key,
  product_id      bigint references ds_products(id) on delete cascade,
  supplier_id     bigint references suppliers(id) on delete cascade,
  unit_cost_usd   numeric,
  shipping_usd    numeric,
  duties_usd      numeric default 0,
  processing_days numeric,
  shipping_days   jsonb,
  packaging       text,
  source          text,           -- quote email, supplier site, sample invoice
  observed_at     timestamptz not null default now(),
  basis           text not null default 'quoted'  -- quoted | verified_by_order | estimated
);

-- ---------------- Real estate ----------------
create table if not exists re_jurisdictions (
  id                 text primary key,              -- e.g. TX
  name               text not null,
  status             text not null default 'research_only',  -- research_only | outreach_ok | transactions_ok
  requirements       jsonb,                         -- verified rules with sources and dates
  attorney_review    jsonb,                         -- {reviewer, firm, reviewed_on, scope} entered by you
  approved_templates jsonb not null default '[]',   -- [{name, version, reviewed_by, reviewed_on}]
  updated_at         timestamptz not null default now()
);
insert into re_jurisdictions (id, name, requirements) values ('TX', 'Texas (Bryan / College Station first)', '{
  "equitable_interest": {"rule": "Tex. Occ. Code §1101.0045: an unlicensed person may sell or offer an equitable interest (contract/option) only with written disclosure that they are selling an interest in a contract and do not own the property.", "source": "https://capitol.texas.gov/tlodocs/85R/billtext/html/SB02212F.htm"},
  "seller_disclosure": {"rule": "Since Jan 1, 2024 (SB 1577) the same written notice must also be given to the seller before the contract is signed.", "source": "SB 1577 (88th Legislature)"},
  "brokerage": {"rule": "Acting for others for compensation (finding buyers for property you do not control, splitting commissions) requires a TREC license.", "source": "https://www.trec.texas.gov"},
  "non_disclosure_state": {"rule": "Texas does not make sale prices public; closed-sale comps need MLS access through a licensed agent or a paid data provider.", "source": "general Texas practice; confirm with your title company"},
  "outreach": {"rule": "Homeowners are consumers: calls/texts to residential and cell numbers fall under TCPA and the National Do Not Call Registry; AI/prerecorded voice needs prior express written consent.", "source": "FCC TCPA rules; 2024 AI-voice ruling"},
  "verified_on": "2026-10-06",
  "needs_attorney": "Assignment clauses, seller disclosure form, buyer disclosure form, earnest-money terms, and closing process must be reviewed by a Texas real estate attorney before any transaction."
}') on conflict (id) do nothing;

create table if not exists properties (
  id              bigint generated always as identity primary key,
  jurisdiction    text references re_jurisdictions(id) default 'TX',
  address         text not null,
  city            text,
  zip             text,
  county          text,
  parcel_id       text,
  facts           jsonb,          -- beds, baths, sqft, year, lot... each {value, source, observed_at}
  owner           jsonb,          -- {name, mailing_address, source, observed_at} (public record only)
  dedupe_key      text unique,    -- normalized address
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists re_deals (
  id              bigint generated always as identity primary key,
  property_id     bigint references properties(id),
  stage           text not null default 'lead',  -- lead | contacted | conversation | meeting | underwriting | offer_review | offer_sent | under_contract | due_diligence | marketing | buyer_selected | assignment_signed | closing | closed | cancelled | professional_review
  seller_contact  jsonb,          -- name, phone, email with source; consent + DNC status
  seller_notes    jsonb,          -- condition, objectives, timing, occupancy, asking price (as stated by seller)
  underwriting    jsonb,
  max_offer_usd   numeric,
  offer           jsonb,
  contract        jsonb,          -- executed terms, assignability, earnest money, option period
  assignment      jsonb,          -- buyer, fee, status
  fee_estimate_usd numeric,
  fee_collected_usd numeric,
  opted_out       boolean not null default false,
  blockers        text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists deadlines (
  id           bigint generated always as identity primary key,
  division     text references divisions(id),
  subject_type text not null,       -- re_deal | project | order
  subject_id   bigint not null,
  kind         text not null,       -- option_period | earnest_money | inspection | closing | financing | title_commitment
  due_at       timestamptz not null,
  status       text not null default 'open',   -- open | met | missed | waived
  notes        text,
  created_at   timestamptz not null default now()
);
create table if not exists buyers (
  id            bigint generated always as identity primary key,
  name          text not null,
  email         text,
  phone         text,
  criteria      jsonb,              -- areas, property types, price range, rehab level, funding, closing days
  consent       jsonb not null,     -- {how, when, evidence} opt-in proof; required
  verified      jsonb,              -- proof of funds reviewed {by, on, method}
  status        text not null default 'active',  -- active | paused | opted_out
  created_at    timestamptz not null default now()
);
create table if not exists deal_documents (
  id            bigint generated always as identity primary key,
  subject_type  text not null,     -- re_deal | project
  subject_id    bigint not null,
  kind          text not null,     -- seller_disclosure | buyer_disclosure | purchase_agreement | assignment | proposal | addendum
  template      text,              -- name + version from approved_templates
  status        text not null default 'draft',  -- draft | professional_review | approved | sent | viewed | signed | declined | expired
  storage_path  text,
  signers       jsonb,
  history       jsonb not null default '[]',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------- Shared improvement ----------------
create table if not exists experiments (
  id             bigint generated always as identity primary key,
  division       text references divisions(id),
  title          text not null,
  hypothesis     text not null,
  budget_usd     numeric not null default 0,
  spent_usd      numeric not null default 0,
  starts_on      date,
  ends_on        date,
  success        jsonb,            -- metric thresholds
  stop_rules     jsonb,
  expected       jsonb,
  realized       jsonb,
  min_sample     integer,
  status         text not null default 'designed',  -- designed | approved | running | succeeded | failed | stopped | inconclusive
  links          jsonb,            -- related workflow / product / campaign ids
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create table if not exists risk_thresholds (
  id            text primary key,
  division      text references divisions(id),
  metric        text not null,
  limit_value   numeric not null,
  window_days   integer not null default 30,
  action        text not null default 'pause',   -- pause | alert
  description   text
);
insert into risk_thresholds (id, division, metric, limit_value, window_days, description) values
  ('ds_refund_rate',   'dropship', 'refund_rate',       0.08, 30, 'Pause a product if refunds exceed 8% of orders'),
  ('ds_late_rate',     'dropship', 'late_delivery_rate', 0.15, 30, 'Pause a supplier/product if >15% of orders arrive late'),
  ('ds_margin_floor',  'dropship', 'margin_below_floor', 0,   7,  'Pause a product when current landed cost breaks its approved price floor'),
  ('etsy_exception',   'etsy',     'open_exceptions',   3,    7,  'Alert when 3+ Etsy orders are in exception'),
  ('agency_bounce',    'agency',   'bounce_rate',       0.08, 7,  'Pause outreach if >8% of emails bounce'),
  ('ai_overspend',     'hq',       'ai_spend_vs_budget', 1.0, 1,  'Agents pause at the daily AI budget')
on conflict (id) do nothing;

create table if not exists cash_reserves (
  id          text primary key,
  description text not null,
  amount_usd  numeric not null default 0,
  updated_at  timestamptz not null default now()
);
insert into cash_reserves (id, description, amount_usd) values
  ('refunds',  'Refunds and chargebacks reserve', 0),
  ('suppliers','Supplier obligations (orders accepted, not yet paid)', 0),
  ('deposits', 'Earnest money and deposits (only with your explicit approval)', 0),
  ('operating','Operating expenses (30 days of software and AI)', 0)
on conflict (id) do nothing;

alter table settings add column if not exists dropship_rules jsonb not null default
  '{"min_margin_pct":0.2,"max_order_cost_usd":60,"max_test_ad_budget_usd":100,"hold_high_value_usd":150}';
alter table settings add column if not exists realestate_rules jsonb not null default
  '{"markets":["Bryan, TX","College Station, TX"],"min_assignment_fee_usd":5000,"max_offer_pct_of_arv":0.7,"earnest_money_max_usd":0}';

do $$
declare t text;
begin
  foreach t in array array['ds_products','suppliers','supplier_quotes','re_jurisdictions','properties','re_deals','deadlines','buyers',
    'deal_documents','experiments','risk_thresholds','cash_reserves'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
    begin execute format('alter publication supabase_realtime add table %I', t); exception when duplicate_object then null; end;
  end loop;
end $$;

-- Phone tasks can belong to a real estate deal as well as an agency prospect.
alter table call_tasks add column if not exists re_deal_id bigint references re_deals(id);
-- Owner-recorded milestones on real estate deals (contract executed, closing confirmed, funds received).
alter table re_deals add column if not exists checklist jsonb not null default '[]';
alter table re_deals add column if not exists jurisdiction text references re_jurisdictions(id) default 'TX';
