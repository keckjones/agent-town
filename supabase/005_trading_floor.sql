-- =====================================================================
-- Migration 005: Trading floor controls
--  * Per-business pause: tasks for agents in a paused division are not claimed.
--  * Per-agent pause already exists (agents.enabled = false).
--  * Helpful indexes for the live floor.
-- Run AFTER 004. Additive only. Safe to run again.
-- =====================================================================

create or replace function claim_next_task()
returns setof tasks
language sql
as $$
  update tasks set status = 'running', started_at = now(), attempts = attempts + 1
  where id = (
    select t.id from tasks t
    join agents a on a.id = t.agent_id
    left join divisions d on d.id = a.division
    where t.status = 'queued' and t.run_after <= now() and a.enabled
      and coalesce(d.status, 'active') <> 'paused'
    order by t.priority, t.created_at
    for update of t skip locked
    limit 1
  )
  returning *;
$$;

alter table divisions add column if not exists paused_at  timestamptz;
alter table divisions add column if not exists paused_note text;

create index if not exists tasks_agent_status_idx on tasks (agent_id, status);
create index if not exists workflow_events_recent_idx on workflow_events (created_at desc);

-- Live updates for business pause switches and the task queue (desk status).
do $$
declare t text;
begin
  foreach t in array array['divisions','tasks','approvals','agents'] loop
    begin
      execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null;
              when undefined_object then null;
    end;
  end loop;
end $$;
