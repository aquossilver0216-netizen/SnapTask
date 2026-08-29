-- Supabase SQL Editorで一度だけ実行してください。
create table if not exists public.snaptask_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.snaptask_data enable row level security;

drop policy if exists "users read own data" on public.snaptask_data;
drop policy if exists "users insert own data" on public.snaptask_data;
drop policy if exists "users update own data" on public.snaptask_data;

create policy "users read own data" on public.snaptask_data
  for select using (auth.uid() = user_id);
create policy "users insert own data" on public.snaptask_data
  for insert with check (auth.uid() = user_id);
create policy "users update own data" on public.snaptask_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
