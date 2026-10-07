-- =====================================================================
-- Migration 004: Brand registry, social content team, niche video channels, CEO promotions.
-- Run AFTER 003. Additive only. Safe to run again.
-- =====================================================================

insert into divisions (id, name, description, sort) values
  ('media', 'Brands, Social & Video', 'Brand registry, social content, and niche video channels', 10)
on conflict (id) do update set name = excluded.name, description = excluded.description;

insert into agents (id, name, building, role, division) values
  ('brand_dev',     'Brand Development',          'media', 'Researches niches; proposes names, positioning, identity',      'media'),
  ('account_prov',  'Account Provisioning',       'media', 'Guides account setup; verifies access; tracks token health',     'media'),
  ('strategy',      'Social Strategy',            'media', 'Audience, themes, calendar, cadence per brand',                  'media'),
  ('scriptwriter',  'Research & Script',          'media', 'Sourced scripts, hooks, captions, CTAs',                         'media'),
  ('creative',      'Creative Production',        'media', 'Original images, carousels and animated video',                  'media'),
  ('editor',        'Editing',                    'media', 'Pacing, captions, formats, readability (separate from creation)', 'media'),
  ('content_qa',    'Quality Review',             'media', 'Blocks publishing when any check fails',                         'media'),
  ('publisher',     'Publishing',                 'media', 'Publishes to the fixed destination account, exactly once',       'media'),
  ('community',     'Community Management',       'media', 'Reads comments; routes questions; escalates issues',             'media'),
  ('growth',        'Growth & Attribution',       'media', 'Measures results; separates organic and paid',                   'media'),
  ('packaging',     'Thumbnail & Packaging',      'media', 'Accurate titles, thumbnails, descriptions, chapters',            'media'),
  ('monetize',      'Monetization',               'media', 'Eligibility, disclosures, earned vs potential revenue',          'media')
on conflict (id) do nothing;

create table if not exists brands (
  id              bigint generated always as identity primary key,
  name            text not null,
  slug            text unique,
  description     text,
  niche           text,
  audience        text,
  offers          jsonb not null default '[]',      -- products/services this brand sells (links to divisions)
  identity        jsonb not null default '{}',      -- colors, fonts, tone, logo path, bio, handles
  domain          text,
  storefront      text,
  business_division text references divisions(id),  -- which business it supports (agency, etsy, dropship, sports...)
  kind            text not null default 'social',   -- social | video_channel | both
  status          text not null default 'proposed', -- proposed | experiment_approved | experimenting | validated | active | paused | retired
  research        jsonb,
  name_check      jsonb,                            -- conflicts found; NOT a trademark clearance
  experiment      jsonb,                            -- hypothesis, budget, days, success criteria, stop rules
  success_criteria jsonb,
  budget_usd      numeric not null default 0,
  spent_usd       numeric not null default 0,
  ceo_agent_id    text references agents(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists brand_accounts (
  id               bigint generated always as identity primary key,
  brand_id         bigint not null references brands(id) on delete cascade,
  platform         text not null,                  -- youtube | instagram | tiktok | facebook
  handle           text,
  profile_url      text,
  external_id      text,                           -- verified platform id (e.g. YouTube channel id)
  status           text not null default 'planned',-- planned | owner_setup | awaiting_connection | connected | manual_only | error | revoked
  publish_mode     text not null default 'manual', -- api | manual
  permissions      jsonb,
  owner_tasks      jsonb not null default '[]',    -- [{task, done, done_at}]
  token_expires_at timestamptz,
  verified_at      timestamptz,
  health           jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (brand_id, platform)
);

-- Content items gain a fixed brand + destination account and a full production pipeline.
alter table content_items add column if not exists brand_id    bigint references brands(id);
alter table content_items add column if not exists account_id  bigint references brand_accounts(id);
alter table content_items add column if not exists format      text;            -- post | carousel | short | video
alter table content_items add column if not exists stage       text;            -- idea | research | script | creation | editing | review | scheduled | published | measured | blocked
alter table content_items add column if not exists owner_agent text;
alter table content_items add column if not exists due_at      timestamptz;
alter table content_items add column if not exists script      jsonb;           -- hook, beats, captions, cta, sources
alter table content_items add column if not exists sources     jsonb;
alter table content_items add column if not exists versions    jsonb not null default '[]';
alter table content_items add column if not exists review      jsonb;           -- QA checks and results
alter table content_items add column if not exists live_url    text;
alter table content_items add column if not exists external_id text;
alter table content_items add column if not exists metrics     jsonb;
alter table content_items add column if not exists cost_usd    numeric not null default 0;
alter table content_items add column if not exists publish_key text unique;     -- one publication per item per account, ever

create table if not exists asset_rights (
  id          bigint generated always as identity primary key,
  brand_id    bigint references brands(id),
  content_id  bigint references content_items(id) on delete cascade,
  asset_path  text,
  kind        text,         -- image | video | font | music | footage | voice
  origin      text not null,-- generated_here | licensed | owner_provided | public_domain
  license     text,         -- e.g. "SIL Open Font License (Google Fonts)"
  source      text,
  created_at  timestamptz not null default now()
);

create table if not exists brand_metrics (
  id            bigint generated always as identity primary key,
  brand_id      bigint references brands(id) on delete cascade,
  account_id    bigint references brand_accounts(id) on delete cascade,
  content_id    bigint references content_items(id) on delete cascade,
  observed_on   date not null default current_date,
  source        text not null,        -- youtube_api | owner_entered | utm/ledger
  followers     integer,
  views         integer,
  likes         integer,
  comments      integer,
  watch_minutes numeric,
  ctr           numeric,
  link_clicks   integer,
  conversions   integer,
  revenue_usd   numeric,
  paid          boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (content_id, observed_on, source)
);

do $$
declare t text;
begin
  foreach t in array array['brands','brand_accounts','asset_rights','brand_metrics'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
    begin execute format('alter publication supabase_realtime add table %I', t); exception when duplicate_object then null; end;
  end loop;
end $$;
