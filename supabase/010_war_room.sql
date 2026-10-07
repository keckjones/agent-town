-- =====================================================================
-- Migration 010: the War Room. Once a day (8:05 AM by default) the department leads and the Big Boss
-- hold a morning meeting: each lead reports from the records, asks other teams for help, and the Big Boss
-- closes with decisions. One row per day; the floor shows the meeting while it is in session.
-- Run AFTER 009. Additive only. Safe to run again.
-- =====================================================================
create table if not exists meetings (
  id          bigint generated always as identity primary key,
  held_on     date unique not null default current_date,
  status      text not null default 'in_session',   -- in_session | done | failed
  started_at  timestamptz not null default now(),
  ended_at    timestamptz,
  attendees   text[] not null default '{}',          -- agent ids in the room (department leads + manager)
  notes       jsonb not null default '{}',           -- { lines: [{agent, dept, said, asks[]}], decisions[], focus, plain_english, requests[] }
  document_id bigint,
  created_by  text,
  error       text,
  created_at  timestamptz not null default now()
);

alter table meetings enable row level security;
drop policy if exists "owner full access" on meetings;
create policy "owner full access" on meetings for all to authenticated using (true) with check (true);
do $$ begin
  alter publication supabase_realtime add table meetings;
exception when duplicate_object then null; when undefined_object then null; end $$;
