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

create table if not exists public.snaptask_subscriptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  stripe_customer_id text,
  stripe_subscription_id text unique,
  status text not null default 'inactive',
  current_period_end timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.snaptask_subscriptions enable row level security;
drop policy if exists "users read own subscription" on public.snaptask_subscriptions;
create policy "users read own subscription" on public.snaptask_subscriptions
  for select using (auth.uid() = user_id);

create table if not exists public.snaptask_api_usage (
  user_id uuid references auth.users(id) on delete cascade,
  month text not null,
  count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
alter table public.snaptask_api_usage enable row level security;
drop policy if exists "users read own api usage" on public.snaptask_api_usage;
create policy "users read own api usage" on public.snaptask_api_usage
  for select using (auth.uid() = user_id);

-- Webhook/APIサーバーだけが使用量を書き込めるよう、insert/update policyは作りません。
create table if not exists public.snaptask_photos (
  id text not null,
  user_id uuid references auth.users(id) on delete cascade,
  name text not null,
  data_url text not null,
  kind text not null default 'task',
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);
alter table public.snaptask_photos enable row level security;
drop policy if exists "users read own photos" on public.snaptask_photos;
drop policy if exists "users insert own photos" on public.snaptask_photos;
drop policy if exists "users update own photos" on public.snaptask_photos;
drop policy if exists "users delete own photos" on public.snaptask_photos;
create policy "users read own photos" on public.snaptask_photos for select using (auth.uid() = user_id);
create policy "users insert own photos" on public.snaptask_photos for insert with check (auth.uid() = user_id);
create policy "users update own photos" on public.snaptask_photos for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "users delete own photos" on public.snaptask_photos for delete using (auth.uid() = user_id);

-- 写真原本はStorageの非公開バケットへ保存します。アプリからはログイン中の本人だけが読めます。
insert into storage.buckets (id, name, public)
values ('snaptask-photos', 'snaptask-photos', false)
on conflict (id) do update set public = false;

drop policy if exists "users read own snaptask photos" on storage.objects;
drop policy if exists "users upload own snaptask photos" on storage.objects;
drop policy if exists "users update own snaptask photos" on storage.objects;
drop policy if exists "users delete own snaptask photos" on storage.objects;

create policy "users read own snaptask photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'snaptask-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users upload own snaptask photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'snaptask-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users update own snaptask photos" on storage.objects
  for update to authenticated
  using (bucket_id = 'snaptask-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'snaptask-photos' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "users delete own snaptask photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'snaptask-photos' and (storage.foldername(name))[1] = auth.uid()::text);
