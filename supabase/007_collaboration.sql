-- =====================================================================
-- Migration 007: agents working together.
--  * team_projects: an idea (yours or an agent's) broken into steps by the Big Boss.
--  * work_requests: one agent asking another for something (a website, a brand, posts, research...).
--  * sites: landing pages the team builds and (after your approval) hosts at <worker>/p/<slug>.
-- Run AFTER 006. Additive only. Safe to run again.
-- =====================================================================

create table if not exists team_projects (
  id           bigint generated always as identity primary key,
  title        text not null,
  idea         text not null,                     -- the idea as given
  source       text not null default 'owner',     -- owner | agent id
  status       text not null default 'planning',  -- planning | waiting_approval | active | done | cancelled
  plan         jsonb,                             -- the Big Boss's plan: goal, plain_english, steps[]
  workflow_id  bigint,
  approval_id  bigint,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists work_requests (
  id             bigint generated always as identity primary key,
  project_id     bigint references team_projects(id) on delete set null,
  from_agent     text,
  need           text not null,                   -- landing_page | social_brand | social_content | marketing_campaign | research | etsy_product | store_product | local_leads | experiment_design
  title          text not null,
  brief          jsonb not null default '{}',
  division       text,
  workflow_id    bigint,
  depends_on     bigint references work_requests(id) on delete set null,
  status         text not null default 'open',    -- open | queued | in_progress | done | blocked | rejected | waiting_approval
  assigned_agent text,
  task_id        bigint,
  result         jsonb,
  output_ref     text,                            -- e.g. site:3, brand:2, document:9
  dedupe_key     text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists work_requests_status_idx on work_requests (status, created_at);

create table if not exists sites (
  id           bigint generated always as identity primary key,
  slug         text unique not null,
  title        text not null,
  html_path    text,
  preview_path text,
  status       text not null default 'draft',     -- draft | published | unpublished
  request_id   bigint references work_requests(id) on delete set null,
  project_id   bigint references team_projects(id) on delete set null,
  brand_id     bigint,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table settings add column if not exists daily_request_cap integer not null default 12;  -- max agent-to-agent requests started per day

do $$
declare t text;
begin
  foreach t in array array['team_projects','work_requests','sites'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;
