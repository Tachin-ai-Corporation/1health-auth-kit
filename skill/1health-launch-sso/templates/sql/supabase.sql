-- 1health launch SSO — Supabase migration. Adapt `public.profiles` to the table whose `id` = auth.users.id.
-- If there is no such table, create public.one_health_links(user_id uuid primary key references auth.users(id) on delete cascade, …)
-- with the same three columns and point the templates' PROFILE_TABLE at it.

alter table public.profiles
  add column if not exists one_health_env       text,
  add column if not exists one_health_tenant_id text,
  add column if not exists one_health_user_id   text;

create unique index if not exists profiles_one_health_identity_uidx
  on public.profiles (one_health_env, one_health_tenant_id, one_health_user_id)
  where one_health_user_id is not null;

-- Email → auth.users.id, callable only by the service role.
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid language sql security definer set search_path = '' as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1
$$;
revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
grant execute on function public.auth_user_id_by_email(text) to service_role;

-- Launch audit (identifiers only — never emails, tokens or codes).
create table if not exists public.one_health_launch_audit (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  outcome text not null check (outcome in ('success','no_user','pending_confirm','failure')),
  failure_reason text,
  one_health_env text,
  one_health_tenant_id text,
  one_health_user_id text,
  app_user_id uuid
);
alter table public.one_health_launch_audit enable row level security;  -- no policies: service role only
grant insert, select on public.one_health_launch_audit to service_role;
create index if not exists one_health_launch_audit_created_idx on public.one_health_launch_audit (created_at desc);
