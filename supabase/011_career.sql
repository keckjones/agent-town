-- =====================================================================
-- Migration 011: the Career Office. A personal job-search agent that researches roles, prepares
-- application packets, finds VERIFIED contacts, and sends personalized outreach + one follow-up
-- from your own school Gmail account (never from the business address).
-- Personal details (resume text, contacts, saved jobs) are NOT in this file: they are loaded from a
-- private setup file you run once. Run AFTER 010. Additive only. Safe to run again.
-- =====================================================================
insert into divisions (id, name, description, sort) values
  ('career', 'Career Office', 'Your personal job search: applications, verified contacts, outreach and follow-ups', 12)
on conflict (id) do update set name = excluded.name, description = excluded.description;

insert into agents (id, name, building, role, division) values
  ('career', 'Career Agent', 'career', 'Job search: application packets, verified contacts, personalized outreach and follow-ups', 'career')
on conflict (id) do update set name = excluded.name, role = excluded.role, division = excluded.division;

create table if not exists career_profile (
  id                integer primary key default 1 check (id = 1),
  full_name         text,
  sender_email      text not null default 'keckjones@tamu.edu',   -- emails go out ONLY from this signed-in account
  phone             text,
  linkedin_url      text,
  location          text,
  signature         text,                                         -- appended to every email
  resume_path       text,                                         -- storage: career/resume.pdf
  resume_filename   text,
  resume_text       text,                                         -- source of truth for what the agent may say
  goals             jsonb not null default '{}',                  -- targets, cities, positioning per track
  rules             jsonb not null default '{}',                  -- e.g. never claim current employment at X
  daily_cap         integer not null default 5,                   -- outreach + follow-ups per weekday
  follow_up_business_days integer not null default 7,
  sending_enabled   boolean not null default false,               -- you confirm the old ChatGPT automation is off
  auto_send         boolean not null default false,               -- false: each email waits in Approvals
  multi_contact_companies text[] not null default '{}',           -- companies where several people may be contacted (e.g. Charles Schwab)
  state             jsonb not null default '{}',                  -- agent bookkeeping (last contact research per company…)
  updated_at        timestamptz not null default now()
);

create table if not exists career_jobs (
  id                 bigint generated always as identity primary key,
  company            text not null,
  title              text not null,
  location           text,
  url                text unique,
  source             text not null default 'linkedin_saved',   -- linkedin_saved | owner | research
  track              text,                                      -- investment_banking | investment_analyst | supply_chain
  status             text not null default 'saved',             -- saved | reviewing | packet_ready | filled | submitted | interview | offer | rejected | closed | skipped
  posting_status     text not null default 'unverified',        -- unverified | open | closed (you or the agent confirmed)
  posting_text       text,                                      -- paste the job description here for the best packet
  fit                jsonb,                                     -- { score, strengths[], gaps[], summary }
  packet             jsonb,                                     -- { why_company, cover_note, answers[], owner_questions[] }
  notes              text,
  applied_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists career_contacts (
  id                 bigint generated always as identity primary key,
  name               text not null,
  title              text,
  company            text not null,
  location           text,
  email              text,
  email_verified     boolean not null default false,
  email_source       text,            -- owner (you gave it) | page (seen on a public page, URL below) | reply (they emailed you)
  email_source_url   text,
  linkedin_url       text,
  profile_source_url text,            -- where the role/title was verified (e.g. official company page)
  channel            text not null default 'email',  -- email | linkedin | phone
  status             text not null default 'new',    -- new | contacted | followed_up | replied | declined | opted_out | bounced | do_not_contact
  priority           integer not null default 5,     -- 1 = highest
  track              text,
  job_id             bigint references career_jobs(id) on delete set null,
  thread_id          text,                            -- Gmail thread of our outreach
  notes              text,
  last_verified_at   timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create unique index if not exists career_contacts_email_uq on career_contacts (lower(email)) where email is not null;

create table if not exists career_messages (
  id              bigint generated always as identity primary key,
  contact_id      bigint references career_contacts(id) on delete set null,
  direction       text not null default 'out',       -- out | in
  kind            text not null,                     -- intro | follow_up | linkedin_note | reply | bounce
  subject         text,
  body            text,
  to_email        text,
  status          text not null default 'draft',     -- draft | pending_approval | sent | failed | skipped | to_send_by_you
  via             text,                              -- gmail_api | you | chatgpt (sent before this system)
  gmail_id        text,
  thread_id       text,
  attachment      text,                              -- file name attached, if any
  similarity      numeric,                           -- highest overlap with any earlier email (0-1); kept low on purpose
  approval_id     bigint,
  follow_up_due   date,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists career_messages_contact_idx on career_messages (contact_id, created_at);

-- Resume upload from the dashboard (signed-in owner only, career/ folder only).
drop policy if exists "owner uploads career files" on storage.objects;
create policy "owner uploads career files" on storage.objects for insert to authenticated with check (bucket_id = 'town-files' and name like 'career/%');
drop policy if exists "owner replaces career files" on storage.objects;
create policy "owner replaces career files" on storage.objects for update to authenticated using (bucket_id = 'town-files' and name like 'career/%');

do $$
declare t text;
begin
  foreach t in array array['career_profile','career_jobs','career_contacts','career_messages'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;
insert into career_profile (id) values (1) on conflict (id) do nothing;
alter table career_profile add column if not exists multi_contact_companies text[] not null default '{}';
alter table career_profile add column if not exists state jsonb not null default '{}';
