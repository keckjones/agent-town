-- =====================================================================
-- Agent Town → Business Command Center (migration 002)
-- Run AFTER schema.sql. Only ADDS tables/columns; existing data is kept.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- =====================================================================

-- ---------- Business divisions ----------
create table if not exists divisions (
  id          text primary key,
  name        text not null,
  description text,
  status      text not null default 'active',     -- active | paused
  sort        integer not null default 0
);
insert into divisions (id, name, description, sort) values
  ('hq',        'Executive Overview',            'Orchestration, priorities, and company-wide controls', 1),
  ('agency',    'Local Website Agency',          'Prospect-to-customer website builds in Bryan-College Station and beyond', 2),
  ('sports',    'Sports Platform Marketing',     'Marketing for KJ''s Picks using the official picks ledger', 3),
  ('etsy',      'Etsy Commerce',                 'Research-to-fulfillment Etsy shop', 4),
  ('ventures',  'Market Research & New Ventures','Opportunity discovery and small experiments', 5),
  ('customers', 'Customer Operations',           'Inbox, support, and follow-through until resolved', 6),
  ('finance',   'Finance & Performance',         'Revenue, costs, and performance by division', 7)
on conflict (id) do update set name = excluded.name, description = excluded.description, sort = excluded.sort;

-- ---------- Agents: responsibilities, permissions, plain-language explanation ----------
alter table agents add column if not exists division    text;
alter table agents add column if not exists permissions jsonb not null default '{}';
alter table agents add column if not exists explanation text;

insert into agents (id, name, building, role) values
  ('opportunity', 'Opportunity Evaluation',  'ventures',  'Scores opportunities and writes investment memos'),
  ('sports',      'Sports Marketing',        'sports',    'Turns official picks into compliant marketing drafts'),
  ('etsy',        'Etsy Product Research',   'etsy',      'Researches demand, competition and economics'),
  ('fulfillment', 'Fulfillment',             'etsy',      'Routes and tracks real customer orders'),
  ('support',     'Customer Support',        'customers', 'Answers routine questions and escalates the rest'),
  ('finance',     'Finance & Analytics',     'finance',   'Tracks revenue, costs, and sends the morning digest'),
  ('qa',          'Quality Assurance',       'agency',    'Checks sites and listings before anything ships'),
  ('caller',      'Phone Sales',             'agency',    'Prepares call scripts and runs consented calls')
on conflict (id) do nothing;

update agents set name = v.name, role = v.role, division = v.division from (values
  ('manager',    'Executive Orchestrator',     'Sets priorities, assigns work, enforces budgets',          'hq'),
  ('research',   'Market Research',            'Researches markets with cited, dated sources',             'ventures'),
  ('opportunity','Opportunity Evaluation',     'Scores opportunities and writes investment memos',         'ventures'),
  ('scout',      'Local Business Prospecting', 'Finds and verifies local businesses',                      'agency'),
  ('inspector',  'Lead Qualification',         'Audits websites and scores leads',                         'agency'),
  ('designer',   'Website Production',         'Builds private previews and client sites',                 'agency'),
  ('postmaster', 'Sales & Follow-up',          'Outreach, follow-ups, proposals within approved scope',    'agency'),
  ('caller',     'Phone Sales',                'Prepares call scripts and runs consented calls',           'agency'),
  ('qa',         'Quality Assurance',          'Checks sites and listings before anything ships',          'agency'),
  ('sports',     'Sports Marketing',           'Turns official picks into compliant marketing drafts',     'sports'),
  ('marketer',   'Campaign Strategy',          'Plans campaigns across divisions',                         'sports'),
  ('social',     'Social Content',             'Writes platform-specific posts',                           'sports'),
  ('etsy',       'Etsy Product Research',      'Researches demand, competition and economics',             'etsy'),
  ('merchant',   'Product Design & Listing',   'Creates original concepts and listing drafts',             'etsy'),
  ('fulfillment','Fulfillment',                'Routes and tracks real customer orders',                   'etsy'),
  ('support',    'Customer Support',           'Answers routine questions and escalates the rest',         'customers'),
  ('finance',    'Finance & Analytics',        'Tracks revenue, costs, and sends the morning digest',      'finance')
) as v(id, name, role, division) where agents.id = v.id;

-- ---------- Durable workflows + audit trail ----------
create table if not exists workflows (
  id             bigint generated always as identity primary key,
  division       text references divisions(id),
  kind           text not null,                 -- e.g. agency_lead, etsy_product, sports_campaign
  objective      text not null,
  stage          text not null,
  status         text not null default 'active', -- active | waiting_approval | blocked | paused | won | lost | done | cancelled
  owner_agent    text references agents(id),
  subject_type   text,                          -- prospect | product | order | opportunity | campaign
  subject_id     bigint,
  next_action    text,
  next_action_at timestamptz,
  blockers       text,
  recovery       text,
  budget_usd     numeric not null default 0,
  cost_usd       numeric not null default 0,
  evidence       jsonb not null default '[]',   -- [{claim, source, observed_at}]
  data           jsonb not null default '{}',
  dedupe_key     text unique,                   -- prevents duplicate workflows for the same subject
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists workflows_status_idx on workflows (division, status);

create table if not exists workflow_events (
  id          bigint generated always as identity primary key,
  workflow_id bigint references workflows(id) on delete cascade,
  agent_id    text,
  type        text not null,                    -- stage | action | result | cost | error | approval | note
  message     text not null,
  data        jsonb,
  cost_usd    numeric not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists workflow_events_wf_idx on workflow_events (workflow_id, created_at desc);

-- ---------- Idempotency: one external side effect per key, ever ----------
create table if not exists actions (
  key         text primary key,                 -- e.g. email:prospect:12:initial
  kind        text not null,
  status      text not null default 'started',  -- started | done | failed | unknown
  workflow_id bigint,
  request     jsonb,
  result      jsonb,
  error       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Approvals v2 ----------
alter table approvals add column if not exists workflow_id      bigint;
alter table approvals add column if not exists division         text;
alter table approvals add column if not exists reason           text;
alter table approvals add column if not exists evidence         jsonb;
alter table approvals add column if not exists cost_usd         numeric not null default 0;
alter table approvals add column if not exists max_exposure_usd numeric not null default 0;
alter table approvals add column if not exists expected_outcome text;
alter table approvals add column if not exists uncertainty      text;
alter table approvals add column if not exists scope            text;
alter table approvals add column if not exists reversible       boolean not null default true;
alter table approvals add column if not exists expires_at       timestamptz;
alter table approvals add column if not exists payload_hash     text;
alter table approvals add column if not exists approved_hash    text;
alter table approvals add column if not exists decision_note    text;
alter table approvals add column if not exists standing         boolean not null default false;
alter table approvals add column if not exists authority_id     bigint;

-- The database itself enforces: an approval covers exactly the content that was approved.
-- Editing the payload after approval sends it back to "pending".
create or replace function approvals_guard() returns trigger language plpgsql as $$
begin
  new.payload_hash := md5(new.payload::text);
  if tg_op = 'UPDATE' then
    if new.payload is distinct from old.payload and old.status = 'approved' and new.status = 'approved' then
      new.status := 'pending';
      new.approved_hash := null;
      new.decision_note := coalesce(new.decision_note, '') || ' [edited after approval: needs re-approval]';
    end if;
    if new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_hash := new.payload_hash;
      new.decided_at := now();
    end if;
    if new.status in ('rejected', 'changes_requested', 'paused') and old.status is distinct from new.status then
      new.approved_hash := null;
      new.decided_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists approvals_guard on approvals;
create trigger approvals_guard before insert or update on approvals for each row execute function approvals_guard();

-- ---------- Standing approvals ("authorities") ----------
create table if not exists authorities (
  id            bigint generated always as identity primary key,
  kind          text not null,       -- email_campaign | calling_campaign | marketing_campaign | fulfillment
  division      text references divisions(id),
  title         text not null,
  rules         jsonb not null,      -- exact limits: audience, templates, daily cap, channels, max order cost...
  budget_usd    numeric not null default 0,
  spent_usd     numeric not null default 0,
  daily_limit   integer,
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  status        text not null default 'active',   -- active | paused | expired | revoked
  approval_id   bigint references approvals(id),
  version_hash  text not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists authority_usage (
  id           bigint generated always as identity primary key,
  authority_id bigint references authorities(id) on delete cascade,
  action_key   text unique,
  amount_usd   numeric not null default 0,
  created_at   timestamptz not null default now()
);

-- ---------- Integration status (what is really connected) ----------
create table if not exists integrations (
  id          text primary key,
  name        text not null,
  division    text,
  status      text not null default 'needs_setup',  -- connected | needs_setup | error | disabled | unverified
  detail      text,
  setup_steps text,
  checked_at  timestamptz
);

-- ---------- Money: one ledger, every figure labeled actual / estimated / forecast ----------
create table if not exists ledger (
  id           bigint generated always as identity primary key,
  occurred_on  date not null default current_date,
  division     text references divisions(id),
  category     text not null,   -- revenue | refund | ad_spend | fulfillment | ai | software | fees | commitment
  amount_usd   numeric not null,
  basis        text not null default 'actual',   -- actual | estimated | forecast
  source       text,
  external_id  text unique,
  note         text,
  created_at   timestamptz not null default now()
);
insert into ledger (occurred_on, division, category, amount_usd, basis, source, external_id, note)
select received_at, 'agency', 'revenue', amount, 'actual', coalesce(source, 'manual'), 'revenue:' || id, note from revenue
on conflict (external_id) do nothing;

-- ---------- Agency CRM ----------
alter table prospects add column if not exists city               text;
alter table prospects add column if not exists verified_no_website boolean;
alter table prospects add column if not exists website_check      jsonb;
alter table prospects add column if not exists contact_sources    jsonb not null default '[]';
alter table prospects add column if not exists scores             jsonb;
alter table prospects add column if not exists lead_score         integer;
alter table prospects add column if not exists deal_stage         text not null default 'discovered';
alter table prospects add column if not exists deal_value         numeric;
alter table prospects add column if not exists next_step          text;
alter table prospects add column if not exists next_step_at       timestamptz;
alter table prospects add column if not exists followups_sent     integer not null default 0;
alter table prospects add column if not exists last_contacted_at  timestamptz;
alter table prospects add column if not exists replied_at         timestamptz;
alter table prospects add column if not exists opted_out          boolean not null default false;
alter table prospects add column if not exists campaign_id        bigint;
alter table prospects add column if not exists timezone           text not null default 'America/Chicago';

create table if not exists campaigns (
  id           bigint generated always as identity primary key,
  division     text references divisions(id),
  kind         text not null,          -- email_outreach | calling | marketing
  name         text not null,
  status       text not null default 'draft',  -- draft | pending_approval | active | paused | ended
  rules        jsonb not null default '{}',
  authority_id bigint references authorities(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists outreach_messages (
  id          bigint generated always as identity primary key,
  prospect_id bigint references prospects(id),
  customer_id bigint,
  channel     text not null default 'email',
  direction   text not null,          -- out | in
  kind        text,                   -- initial | followup | proposal | reply
  to_address  text,
  subject     text,
  body        text,
  message_id  text,
  in_reply_to text,
  status      text,
  action_key  text unique,
  created_at  timestamptz not null default now()
);

-- ---------- Customers, conversations, projects, invoices ----------
create table if not exists customers (
  id          bigint generated always as identity primary key,
  name        text,
  email       text unique,
  phone       text,
  company     text,
  prospect_id bigint references prospects(id),
  division    text references divisions(id),
  notes       text,
  created_at  timestamptz not null default now()
);
create table if not exists conversations (
  id              bigint generated always as identity primary key,
  customer_id     bigint references customers(id),
  prospect_id     bigint references prospects(id),
  division        text references divisions(id),
  channel         text not null default 'email',
  subject         text,
  status          text not null default 'open',   -- open | waiting_on_us | waiting_on_customer | escalated | resolved
  summary         text,
  last_message_at timestamptz,
  created_at      timestamptz not null default now()
);
create table if not exists messages (
  id              bigint generated always as identity primary key,
  conversation_id bigint references conversations(id) on delete cascade,
  direction       text not null,      -- in | out
  channel         text not null default 'email',
  sender          text,
  subject         text,
  body            text,
  external_id     text unique,
  classification  text,               -- opt_out | interested | question | not_interested | call_request | other
  handled         boolean not null default false,
  created_at      timestamptz not null default now()
);
create table if not exists projects (
  id          bigint generated always as identity primary key,
  customer_id bigint references customers(id),
  prospect_id bigint references prospects(id),
  division    text references divisions(id) default 'agency',
  title       text not null,
  scope       jsonb,
  price_usd   numeric,
  status      text not null default 'proposal',  -- proposal | awaiting_signature | awaiting_payment | onboarding | building | qa | delivered | support | cancelled
  due_on      date,
  qa          jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists invoices (
  id          bigint generated always as identity primary key,
  project_id  bigint references projects(id),
  customer_id bigint references customers(id),
  amount_usd  numeric not null,
  status      text not null default 'draft',     -- draft | sent | paid | void
  provider    text,
  provider_id text unique,
  url         text,
  created_at  timestamptz not null default now(),
  paid_at     timestamptz
);

-- ---------- Phone outreach: consent first ----------
create table if not exists consents (
  id           bigint generated always as identity primary key,
  subject_type text not null,       -- prospect | customer
  subject_id   bigint not null,
  channel      text not null,       -- call | sms | email | recording
  kind         text not null,       -- written | verbal | opt_out
  evidence     text not null,       -- the exact words / message id that shows consent
  source       text,
  created_at   timestamptz not null default now()
);
create table if not exists call_tasks (
  id           bigint generated always as identity primary key,
  prospect_id  bigint references prospects(id),
  campaign_id  bigint references campaigns(id),
  mode         text not null default 'manual',   -- manual | ai
  status       text not null default 'ready',    -- ready | scheduled | calling | done | cancelled
  objective    text,
  phone        text,
  local_tz     text not null default 'America/Chicago',
  eligibility  jsonb,              -- why AI calling is / isn't allowed for this number
  script       text,
  outcome      text,               -- no_answer | voicemail | wrong_number | declined | do_not_contact | interested | meeting_booked | proposal_requested | agreement_sent | agreement_signed | payment_received
  report       jsonb,
  recording_url text,
  transcript   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- Morning text ----------
create table if not exists notify_settings (
  id              integer primary key default 1 check (id = 1),
  phone           text not null default '+19403661992',
  timezone        text not null default 'America/Chicago',
  digest_time     text not null default '07:30',
  digest_enabled  boolean not null default true,
  urgent_alerts   boolean not null default false,
  paused          boolean not null default false,
  dashboard_url   text,
  updated_at      timestamptz not null default now()
);
insert into notify_settings (id) values (1) on conflict (id) do nothing;

create table if not exists sms_messages (
  id           bigint generated always as identity primary key,
  kind         text not null,          -- digest | test | urgent
  digest_date  date,
  to_number    text not null,
  body         text not null,
  status       text not null default 'queued',  -- queued | sending | sent | delivered | failed | undelivered | unknown
  provider_sid text unique,
  error        text,
  attempts     integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists one_digest_per_day on sms_messages (digest_date) where kind = 'digest';

-- ---------- Dashboard → worker requests ----------
create table if not exists commands (
  id          bigint generated always as identity primary key,
  kind        text not null,
  input       jsonb not null default '{}',
  status      text not null default 'queued',   -- queued | running | done | failed
  result      jsonb,
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);

-- ---------- Sports marketing ----------
create table if not exists sports_snapshots (
  id             bigint generated always as identity primary key,
  fetched_at     timestamptz not null default now(),
  model_run      timestamptz,
  stale          boolean not null default false,
  stale_reason   text,
  official_stats jsonb,
  raw_hash       text
);
create table if not exists sports_picks (
  id          text primary key,      -- stable key from the official ledger
  league      text,
  game_id     text,
  pick        text,
  bet_type    text,
  odds        text,
  line        text,
  kickoff     timestamptz,
  status      text,                  -- UPCOMING | LIVE | WIN | LOSS | PUSH | VOID | WITHDRAWN
  data        jsonb,
  odds_as_of  timestamptz,
  first_seen  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists channels (
  id                  text primary key,     -- e.g. sports_x, sports_instagram, sports_newsletter
  division            text references divisions(id),
  name                text not null,
  enabled             boolean not null default false,
  policy_verified_at  timestamptz,
  policy_notes        text,
  requirements        jsonb not null default '{}'
);
insert into channels (id, division, name, requirements) values
  ('sports_x',          'sports', 'X (organic posts)',         '{"age_gate":"21+","footer":"21+ | Gambling problem? Call 1-800-GAMBLER","paid_ads":false}'),
  ('sports_instagram',  'sports', 'Instagram (organic posts)', '{"age_gate":"21+","footer":"21+ | Gambling problem? Call 1-800-GAMBLER","paid_ads":false}'),
  ('sports_facebook',   'sports', 'Facebook (organic posts)',  '{"age_gate":"21+","footer":"21+ | Gambling problem? Call 1-800-GAMBLER","paid_ads":false}'),
  ('sports_newsletter', 'sports', 'Email newsletter (opt-in)', '{"age_gate":"21+","footer":"21+ | Gambling problem? Call 1-800-GAMBLER","consent":"opt-in subscribers only"}'),
  ('sports_meta_ads',   'sports', 'Meta paid ads',             '{"blocked_until":"Meta prior written permission for gambling-related ads","paid_ads":true}')
on conflict (id) do nothing;

create table if not exists content_items (
  id           bigint generated always as identity primary key,
  division     text references divisions(id),
  channel      text references channels(id),
  kind         text not null default 'post',      -- post | newsletter | graphic | ad
  title        text,
  body         text not null,
  assets       jsonb,
  source_refs  jsonb,             -- pick ids + the status/odds they had when drafted
  status       text not null default 'draft',     -- draft | pending_approval | approved | scheduled | published | withdrawn | needs_revision
  scheduled_at timestamptz,
  published_at timestamptz,
  utm          text,
  withdraw_reason text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------- Etsy ----------
create table if not exists products (
  id                bigint generated always as identity primary key,
  division          text references divisions(id) default 'etsy',
  stage             text not null default 'idea',  -- idea | researched | concept | economics | review | approved | listed | paused | retired
  title             text not null,
  concept           jsonb,
  economics         jsonb,        -- every figure marked observed vs estimated
  evidence          jsonb,
  ip_check          jsonb,
  listing           jsonb,
  fulfillment_model text,         -- digital | print_on_demand | production_partner
  supplier          text,
  sample_status     text,         -- not_needed | needed | ordered | approved | rejected
  etsy_listing_id   text unique,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create table if not exists orders (
  id          bigint generated always as identity primary key,
  division    text references divisions(id) default 'etsy',
  platform    text not null default 'etsy',
  external_id text unique,
  product_id  bigint references products(id),
  customer_id bigint references customers(id),
  status      text not null default 'new',   -- new | validated | fulfilling | shipped | delivered | exception | cancelled | refunded
  amount_usd  numeric,
  fees_usd    numeric,
  cost_usd    numeric,
  data        jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- New ventures ----------
create table if not exists opportunities (
  id          bigint generated always as identity primary key,
  title       text not null,
  status      text not null default 'proposed',  -- proposed | approved_experiment | running | validated | stopped
  scores      jsonb,
  memo        text,
  data        jsonb,
  budget_usd  numeric not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------- Agency settings: areas, approved pricing, follow-up rules ----------
alter table settings add column if not exists outreach_areas text[] not null
  default array['College Station, TX','Bryan, TX','Navasota, TX','Brenham, TX','Hearne, TX','Caldwell, TX','Madisonville, TX'];
alter table settings add column if not exists agency_pricing jsonb not null
  default '{"landing_page":{"min":300,"max":800},"multi_page":{"min":900,"max":2000},"care_plan_monthly":{"min":50,"max":150},"deposit_pct":50,"max_discount_pct":10}';
alter table settings add column if not exists followup_rules jsonb not null default '{"days_after":[4,10],"max_followups":2}';
alter table settings add column if not exists sports_rules jsonb not null
  default '{"footer":"21+ | Not a sportsbook. No bets taken. Picks are model output, not a guarantee. Gambling problem? Call 1-800-GAMBLER","max_odds_age_hours":6}';

-- ---------- Server-only secrets (OAuth tokens). No dashboard access at all: RLS on, no policy. ----------
create table if not exists secrets (
  id          text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now()
);
alter table secrets enable row level security;

-- ---------- Security: owner-only access for every new table ----------
do $$
declare t text;
begin
  foreach t in array array['divisions','workflows','workflow_events','actions','authorities','authority_usage','integrations',
    'ledger','campaigns','outreach_messages','customers','conversations','messages','projects','invoices','consents',
    'call_tasks','notify_settings','sms_messages','commands','sports_snapshots','sports_picks','channels','content_items',
    'products','orders','opportunities'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Live updates ----------
do $$
declare t text;
begin
  foreach t in array array['workflows','workflow_events','integrations','ledger','conversations','messages','call_tasks',
    'sms_messages','commands','content_items','products','orders','opportunities','authorities','notify_settings','sports_picks'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;
