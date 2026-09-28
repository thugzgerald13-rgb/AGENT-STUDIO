-- Agent Studio — Supabase (PostgreSQL) schema
-- Run this in Supabase → SQL Editor. Replaces the JSON file storage.
-- One generic table mirrors the JSON stores exactly; routes need zero changes.

create table if not exists app_data (
  store      text not null,           -- 'users','agents','conversations','crewRuns','usage','config','apiKeys'
  id         text not null,           -- record id (same as in JSON)
  data       jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (store, id)
);

create index if not exists app_data_store_idx on app_data (store);
create index if not exists app_data_data_gin on app_data using gin (data);

-- Helper: keep updated_at fresh
create or replace function touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end; $$;

drop trigger if exists app_data_touch on app_data;
create trigger app_data_touch before update on app_data
for each row execute function touch_updated_at();

-- Row Level Security (lock down — only service role key used server-side)
alter table app_data enable row level security;
drop policy if exists "service role full access" on app_data;
create policy "service role full access" on app_data
  for all using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- Optional: convenience view for user lookups
create or replace view users_view as
select (data->>'id') as id, (data->>'email') as email, (data->>'tier') as tier
from app_data where store = 'users';
