create table if not exists sleep_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  hours numeric(4,1) not null,
  synced_at timestamptz default now(),
  unique(user_id, date)
);

alter table sleep_logs enable row level security;

create policy "Users can manage own sleep_logs"
  on sleep_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
