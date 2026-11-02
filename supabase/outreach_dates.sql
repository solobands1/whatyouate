-- Outreach dates: when each creator was added (created_at, already stored) and when their warm-up post
-- was pulled, so the Outreach page can show how fresh the info is. Run after outreach_warmup.sql. Safe to rerun.
alter table public.outreach_contacts add column if not exists warm_pulled_at timestamptz;

-- Rows that already have a post: best guess is the last update before it was ticked off.
update public.outreach_contacts set warm_pulled_at = least(updated_at, commented_at)
where warm_post_url <> '' and warm_pulled_at is null;

-- Stamp the date whenever the warm-up script saves a new post, so the script itself doesn't change.
create or replace function public.outreach_stamp_warm_pull()
returns trigger language plpgsql as $$
begin
  if new.warm_post_url <> '' and new.warm_post_url is distinct from old.warm_post_url then
    new.warm_pulled_at := now();
  end if;
  return new;
end $$;
drop trigger if exists outreach_stamp_warm_pull on public.outreach_contacts;
create trigger outreach_stamp_warm_pull before update on public.outreach_contacts
  for each row execute function public.outreach_stamp_warm_pull();

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
        'warmPostUrl', warm_post_url, 'warmComment', warm_comment, 'commentedAt', commented_at,
        'addedAt', created_at, 'warmAt', warm_pulled_at
      ) order by block, position, created_at), '[]'::jsonb) from outreach_contacts)
  );
end $$;
