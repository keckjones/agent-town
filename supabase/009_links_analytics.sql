-- =====================================================================
-- Migration 009: every public thing the agents create gets a link you can open, plus its analytics.
--  * published_links: one row per live page, post, video, listing, store product or account.
--  * site_visits / site_visitors: privacy-friendly visit + click counts for pages hosted at <worker>/p/<slug>
--    (no cookies; visitors are counted with a daily one-way hash, never stored raw).
-- Run AFTER 008. Additive only. Safe to run again.
-- =====================================================================
create table if not exists published_links (
  id                 bigint generated always as identity primary key,
  url                text unique not null,
  title              text not null,
  kind               text not null,            -- page | video | post | listing | store_product | account
  platform           text not null,            -- web | youtube | instagram | tiktok | facebook | x | etsy | shopify | other
  where_it_lives     text,                     -- e.g. "YouTube channel @deskfixdaily", "Etsy shop", "Your site"
  status             text not null default 'live',  -- live | removed
  analytics          text not null default 'auto',  -- auto (we measure it) | manual (you enter numbers) | none
  metrics            jsonb not null default '{}',
  metrics_updated_at timestamptz,
  source_type        text,                     -- site | content | product | ds_product | brand_account | approval | owner
  source_id          bigint,
  brand_id           bigint,
  project_id         bigint,
  created_by         text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create table if not exists site_visits (
  site_id   bigint not null,
  day       date not null default current_date,
  views     integer not null default 0,
  visitors  integer not null default 0,
  clicks    integer not null default 0,
  referrers jsonb not null default '{}',
  primary key (site_id, day)
);
create table if not exists site_visitors (
  site_id bigint not null,
  day     date not null default current_date,
  hash    text not null,
  primary key (site_id, day, hash)
);

create or replace function track_site_visit(p_site bigint, p_hash text, p_ref text)
returns void language plpgsql as $$
declare n integer := 0; is_new boolean;
begin
  insert into site_visitors (site_id, day, hash) values (p_site, current_date, p_hash) on conflict do nothing;
  get diagnostics n = row_count;
  is_new := n > 0;
  insert into site_visits (site_id, day, views, visitors, referrers)
    values (p_site, current_date, 1, case when is_new then 1 else 0 end, case when p_ref is null or p_ref = '' then '{}'::jsonb else jsonb_build_object(p_ref, 1) end)
  on conflict (site_id, day) do update set
    views = site_visits.views + 1,
    visitors = site_visits.visitors + case when is_new then 1 else 0 end,
    referrers = case when p_ref is null or p_ref = '' then site_visits.referrers
      else site_visits.referrers || jsonb_build_object(p_ref, coalesce((site_visits.referrers->>p_ref)::int, 0) + 1) end;
end $$;

create or replace function track_site_click(p_site bigint)
returns void language sql as $$
  insert into site_visits (site_id, day, clicks) values (p_site, current_date, 1)
  on conflict (site_id, day) do update set clicks = site_visits.clicks + 1;
$$;

do $$
declare t text;
begin
  foreach t in array array['published_links','site_visits'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "owner full access" on %I', t);
    execute format('create policy "owner full access" on %I for all to authenticated using (true) with check (true)', t);
    begin execute format('alter publication supabase_realtime add table %I', t);
    exception when duplicate_object then null; when undefined_object then null; end;
  end loop;
end $$;
alter table site_visitors enable row level security;   -- server only
