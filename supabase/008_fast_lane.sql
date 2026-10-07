-- =====================================================================
-- Migration 008: express lane for things you ask for.
-- Claims the next due task at or above a priority (lower number = more urgent), so your own requests
-- (priority 1-2) never wait behind long background jobs. Same safety rules as claim_next_task().
-- Run AFTER 007. Safe to run again.
-- =====================================================================
create or replace function claim_next_task_max(max_priority integer)
returns setof tasks
language sql
as $$
  update tasks set status = 'running', started_at = now(), attempts = attempts + 1
  where id = (
    select t.id from tasks t
    join agents a on a.id = t.agent_id
    left join divisions d on d.id = a.division
    where t.status = 'queued' and t.run_after <= now() and a.enabled and t.priority <= max_priority
      and coalesce(d.status, 'active') <> 'paused'
    order by t.priority, t.created_at
    for update of t skip locked
    limit 1
  )
  returning *;
$$;
