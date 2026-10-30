-- Creator outreach queue (owner only). The owner approves creators in blocks on whatyouate.app/creators/owner/outreach;
-- the app server's cron (/api/cron/outreach) sends email 1, then follow-ups on day 4 and day 10, from contact@whatyouate.app,
-- and stops for anyone who replies, joins the creator program, says no thanks or bounces.
-- Nothing here is readable by creators or the public: tables have RLS on and no policies, and every owner function checks
-- creator_is_owner(). The cron uses the service role.

create table if not exists public.outreach_contacts (
  id uuid primary key default gen_random_uuid(),
  block int not null default 1,
  position int not null default 0,
  first_name text not null check (length(first_name) between 1 and 60),
  full_name text not null default '',
  email text not null unique check (email = lower(email)),
  instagram text not null default '',
  tiktok text not null default '',
  website text not null default '',
  currency text not null default 'USD' check (currency in ('USD', 'CAD')),
  tz text not null default 'America/Toronto',
  hook text not null check (length(hook) between 10 and 400),
  decision text not null default 'pending' check (decision in ('pending', 'approve', 'skip')),
  status text not null default 'queued' check (status in ('queued', 'sent', 'done', 'replied', 'joined', 'opted_out', 'bounced')),
  sent jsonb not null default '[]'::jsonb,          -- [{step, id, ts}] one entry per email sent, in order
  auto_reply boolean not null default false,
  replied_at timestamptz,
  status_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.outreach_contacts enable row level security;
create index if not exists outreach_contacts_block on public.outreach_contacts (block, position);

-- Anyone who said no thanks, kept even if their row is removed, so they're never added again.
create table if not exists public.outreach_dnc (
  email text primary key check (email = lower(email)),
  added_at timestamptz not null default now()
);
alter table public.outreach_dnc enable row level security;

create table if not exists public.outreach_settings (
  id int primary key default 1 check (id = 1),
  live boolean not null default false,       -- off until the owner turns sending on
  paused boolean not null default false,     -- emergency stop, also blocks follow-ups
  last_send timestamptz,
  next_gap_s int not null default 300,
  last_sync timestamptz,
  preview_on date,
  summary_on date
);
alter table public.outreach_settings enable row level security;
insert into public.outreach_settings (id) values (1) on conflict (id) do nothing;

-- ---- Owner functions -------------------------------------------------------------------------------
create or replace function public.owner_outreach_list()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not creator_is_owner() then raise exception 'not_owner'; end if;
  return jsonb_build_object(
    'settings', (select to_jsonb(s) - 'id' from outreach_settings s where id = 1),
    'stats', jsonb_build_object(
      'sent', (select coalesce(sum(jsonb_array_length(sent)), 0) from outreach_contacts),
      'contacted', (select count(*) from outreach_contacts where jsonb_array_length(sent) > 0),
      'replied', (select count(*) from outreach_contacts where status = 'replied'),
      'joined', (select count(*) from outreach_contacts where status = 'joined'),
      'optedOut', (select count(*) from outreach_contacts where status = 'opted_out'),
      'bounced', (select count(*) from outreach_contacts where status = 'bounced')
    ),
    'contacts', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'block', block, 'firstName', first_name, 'fullName', full_name, 'email', email,
        'instagram', instagram, 'tiktok', tiktok, 'website', website, 'currency', currency, 'hook', hook,
        'decision', decision, 'status', status, 'sent', sent, 'repliedAt', replied_at, 'statusAt', status_at
      ) order by block, position, created_at), '[]'::jsonb) from outreach_contacts)
  );
end $$;

create or replace function public.owner_outreach_decide(p_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not creator_is_owner() then raise exception 'not_owner'; end if;
  if p_decision not in ('pending', 'approve', 'skip') then raise exception 'bad decision'; end if;
  -- once email 1 has gone out the decision is locked; pause or the status takes over from there
  update outreach_contacts set decision = p_decision, updated_at = now()
  where id = p_id and jsonb_array_length(sent) = 0;
end $$;

create or replace function public.owner_outreach_decide_block(p_block int, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not creator_is_owner() then raise exception 'not_owner'; end if;
  if p_decision not in ('approve', 'skip') then raise exception 'bad decision'; end if;
  update outreach_contacts set decision = p_decision, updated_at = now()
  where block = p_block and decision = 'pending' and jsonb_array_length(sent) = 0;
end $$;

create or replace function public.owner_outreach_update_hook(p_id uuid, p_hook text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not creator_is_owner() then raise exception 'not_owner'; end if;
  if length(trim(p_hook)) < 10 or length(p_hook) > 400 then raise exception 'line must be 10 to 400 characters'; end if;
  update outreach_contacts set hook = trim(p_hook), updated_at = now() where id = p_id and jsonb_array_length(sent) = 0;
end $$;

create or replace function public.owner_outreach_settings(p_live boolean, p_paused boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not creator_is_owner() then raise exception 'not_owner'; end if;
  update outreach_settings set live = coalesce(p_live, live), paused = coalesce(p_paused, paused) where id = 1;
end $$;

revoke all on function public.owner_outreach_list() from public, anon;
revoke all on function public.owner_outreach_decide(uuid, text) from public, anon;
revoke all on function public.owner_outreach_decide_block(int, text) from public, anon;
revoke all on function public.owner_outreach_update_hook(uuid, text) from public, anon;
revoke all on function public.owner_outreach_settings(boolean, boolean) from public, anon;
grant execute on function public.owner_outreach_list() to authenticated;
grant execute on function public.owner_outreach_decide(uuid, text) to authenticated;
grant execute on function public.owner_outreach_decide_block(int, text) to authenticated;
grant execute on function public.owner_outreach_update_hook(uuid, text) to authenticated;
grant execute on function public.owner_outreach_settings(boolean, boolean) to authenticated;
