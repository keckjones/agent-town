-- =====================================================================
-- Agent Town: database schema
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run more than once.
-- =====================================================================

-- ---------- Agents (one row per character in the town) ----------
create table if not exists agents (
  id            text primary key,           -- 'manager', 'scout', ...
  name          text not null,
  building      text not null,
  role          text not null,
  status        text not null default 'idle', -- idle | working | waiting | error | paused
  current_task  text,
  speech        text,                        -- short line shown in the speech bubble
  xp            integer not null default 0,
  tasks_done    integer not null default 0,
  enabled       boolean not null default true,
  last_seen     timestamptz default now()
);

insert into agents (id, name, building, role) values
  ('manager',   'Mayor Mae',        'town_hall',  'Sets goals, assigns tasks, reviews progress'),
  ('research',  'Librarian Lou',    'library',    'Market research and opportunity reports'),
  ('scout',     'Scout Sam',        'lodge',      'Finds local businesses to pitch'),
  ('inspector', 'Inspector Ida',    'inspector',  'Audits and scores business websites'),
  ('designer',  'Builder Bea',      'workshop',   'Designs new landing pages'),
  ('postmaster','Postmaster Pete',  'post_office','Drafts and sends outreach emails'),
  ('merchant',  'Merchant Mo',      'store',      'Creates product listings'),
  ('marketer',  'Barker Ben',       'billboard',  'Plans marketing campaigns'),
  ('social',    'Crier Cleo',       'square',     'Writes social media posts')
on conflict (id) do nothing;

-- ---------- Task queue ----------
create table if not exists tasks (
  id           bigint generated always as identity primary key,
  agent_id     text not null references agents(id),
  kind         text not null,               -- e.g. 'find_prospects', 'audit_site'
  input        jsonb not null default '{}',
  status       text not null default 'queued', -- queued | running | done | failed | cancelled
  result       jsonb,
  error        text,
  priority     integer not null default 5,  -- lower runs first
  attempts     integer not null default 0,
  created_by   text default 'manager',
  run_after    timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists tasks_queue_idx on tasks (status, priority, run_after);

-- Atomically claim the next task (so two workers never grab the same one)
create or replace function claim_next_task()
returns setof tasks
language sql
as $$
  update tasks set status = 'running', started_at = now(), attempts = attempts + 1
  where id = (
    select t.id from tasks t
    join agents a on a.id = t.agent_id
    where t.status = 'queued' and t.run_after <= now() and a.enabled
    order by t.priority, t.created_at
    for update skip locked
    limit 1
  )
  returning *;
$$;

-- ---------- Activity log (feeds speech bubbles and building logs) ----------
create table if not exists events (
  id          bigint generated always as identity primary key,
  agent_id    text references agents(id),
  level       text not null default 'info', -- info | success | warn | error
  message     text not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists events_recent_idx on events (created_at desc);

-- ---------- Local business prospects (web outreach pipeline) ----------
create table if not exists prospects (
  id              bigint generated always as identity primary key,
  place_id        text unique,
  name            text not null,
  category        text,
  address         text,
  phone           text,
  website         text,
  email           text,
  rating          numeric,
  review_count    integer,
  stage           text not null default 'found', -- found | audited | skipped | designed | drafted | contacted | replied | client | lost
  audit           jsonb,         -- scores and findings
  site_score      integer,       -- 0-100, higher = better existing site
  opportunity     integer,       -- 0-100, higher = better prospect for us
  site_text       text,          -- extracted copy from their site
  old_screenshot  text,          -- storage path
  new_html        text,          -- storage path
  new_screenshot  text,          -- storage path
  comparison      text,          -- storage path (before/after image)
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------- Do-not-contact list (opt-outs) ----------
create table if not exists suppression (
  email       text primary key,
  reason      text,
  created_at  timestamptz not null default now()
);

-- ---------- Approval inbox: nothing goes out without a yes from you ----------
create table if not exists approvals (
  id           bigint generated always as identity primary key,
  agent_id     text references agents(id),
  kind         text not null,       -- email | product | social_post | campaign
  title        text not null,
  payload      jsonb not null,      -- everything needed to carry it out (editable)
  preview      text,                -- storage path to an image, optional
  prospect_id  bigint references prospects(id),
  status       text not null default 'pending', -- pending | approved | rejected | executed | failed | held
  decided_at   timestamptz,
  executed_at  timestamptz,
  result       jsonb,
  created_at   timestamptz not null default now()
);

-- ---------- Reports, product ideas, campaigns, posts ----------
create table if not exists documents (
  id          bigint generated always as identity primary key,
  agent_id    text references agents(id),
  kind        text not null,        -- research_report | product | campaign | social_post | manager_plan
  title       text not null,
  body        text,
  data        jsonb,
  created_at  timestamptz not null default now()
);

-- ---------- Money in (you log payments; the meter fills) ----------
create table if not exists revenue (
  id          bigint generated always as identity primary key,
  amount      numeric not null,
  source      text,                 -- 'web client', 'product sale', ...
  note        text,
  received_at date not null default current_date,
  created_at  timestamptz not null default now()
);

-- ---------- Money out (Claude + other API spend, logged automatically) ----------
create table if not exists usage (
  id          bigint generated always as identity primary key,
  agent_id    text,
  service     text not null,        -- 'claude', 'places', 'web_search'
  units       jsonb,
  cost_usd    numeric not null default 0,
  created_at  timestamptz not null default now()
);

-- ---------- Settings (single row) ----------
create table if not exists settings (
  id                      integer primary key default 1 check (id = 1),
  paused                  boolean not null default false,  -- big red button
  weekly_goal             numeric not null default 2000,
  daily_budget_usd        numeric not null default 5,      -- max API spend per day
  daily_email_cap         integer not null default 15,
  daily_prospect_cap      integer not null default 40,
  outreach_city           text not null default 'College Station, TX',
  outreach_categories     text[] not null default array['restaurant','hair salon','plumber','auto repair','dentist','landscaping','HVAC','bakery'],
  outreach_offer          text not null default 'A new mobile-friendly site at a low local introductory rate, with the exact price to be discussed on a quick call.',
  business_focus          text not null default 'Local website redesign service for small businesses, plus simple digital products.',
  manager_notes           text default '',
  updated_at              timestamptz not null default now()
);
insert into settings (id) values (1) on conflict (id) do nothing;

-- =====================================================================
-- Security: only signed-in users (you) can read or change anything.
-- The worker uses the service key, which bypasses these rules.
-- Turn OFF public sign-ups in Supabase → Authentication → Providers → Email.
-- =====================================================================
do $$
declare t text;
begin
  foreach t in array array['agents','tasks','events','prospects','suppression','approvals','documents','revenue','usage','settings'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- ---------- Live updates for the dashboard ----------
do $$
declare t text;
begin
  foreach t in array array['agents','events','approvals','prospects','revenue','settings','tasks'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ---------- File storage for screenshots and generated pages ----------
insert into storage.buckets (id, name, public)
values ('town-files', 'town-files', false)
on conflict (id) do nothing;

drop policy if exists "owner reads files" on storage.objects;
create policy "owner reads files" on storage.objects
  for select to authenticated using (bucket_id = 'town-files');
