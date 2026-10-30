-- Outreach warm-up: each creator's latest post and a suggested comment, so the owner can comment from
-- @whatyouate.app a day or two before their email lands, and tick it off on the Outreach page.
alter table public.outreach_contacts add column if not exists warm_post_url text not null default '';
alter table public.outreach_contacts add column if not exists warm_comment text not null default '';
alter table public.outreach_contacts add column if not exists commented_at timestamptz;

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
        'decision', decision, 'status', status, 'sent', sent, 'repliedAt', replied_at, 'statusAt', status_at,
        'warmPostUrl', warm_post_url, 'warmComment', warm_comment, 'commentedAt', commented_at
      ) order by block, position, created_at), '[]'::jsonb) from outreach_contacts)
  );
end $$;

create or replace function public.owner_outreach_commented(p_id uuid, p_done boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not creator_is_owner() then raise exception 'not_owner'; end if;
  update outreach_contacts set commented_at = case when p_done then now() else null end, updated_at = now() where id = p_id;
end $$;

revoke all on function public.owner_outreach_commented(uuid, boolean) from public, anon;
grant execute on function public.owner_outreach_commented(uuid, boolean) to authenticated;
