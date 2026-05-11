create table if not exists step_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users not null,
  date date not null,
  steps integer not null,
  synced_at timestamptz default now(),
  unique(user_id, date)
);

alter table step_logs enable row level security;

create policy "Users can manage own step_logs"
  on step_logs for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
