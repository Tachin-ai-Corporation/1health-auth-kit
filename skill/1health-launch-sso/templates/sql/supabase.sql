-- 1health launch SSO — Supabase migration. Adapt `public.profiles` to the table whose `id` = auth.users.id.
-- If there is no such table, use the one_health_links table at the end of this file instead (and delete the
-- profiles statements), then set the templates' PROFILE_TABLE = "one_health_links", PROFILE_ID = "user_id".

alter table public.profiles
  add column if not exists one_health_env       text,
  add column if not exists one_health_tenant_id text,
  add column if not exists one_health_user_id   text;

create unique index if not exists profiles_one_health_identity_uidx
  on public.profiles (one_health_env, one_health_tenant_id, one_health_user_id)
  where one_health_user_id is not null;

-- Only the server (service role) may write the link columns. A launch whose identity matches these columns signs
-- in as that row's user, so a signed-in user who could write them on their own row (the usual "users can update
-- their own profile" RLS policy allows it) could make someone else's 1health launch land in their account.
-- A column-level REVOKE doesn't help while the table-level UPDATE grant exists (Supabase grants it to
-- `authenticated` by default), so a trigger enforces it for every policy, current and future.
create or replace function public.protect_one_health_link() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('anon', 'authenticated') then  -- service_role, postgres, migrations
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.one_health_env is not null or new.one_health_tenant_id is not null or new.one_health_user_id is not null then
      raise exception 'one_health_* columns can only be set by the server' using errcode = '42501';
    end if;
  elsif (new.one_health_env, new.one_health_tenant_id, new.one_health_user_id)
        is distinct from (old.one_health_env, old.one_health_tenant_id, old.one_health_user_id) then
    raise exception 'one_health_* columns can only be set by the server' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists protect_one_health_link on public.profiles;
create trigger protect_one_health_link before insert or update on public.profiles
  for each row execute function public.protect_one_health_link();

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

-- Alternative to the profiles columns: a links table only the server can touch (no RLS policies, no grants to
-- anon/authenticated, so the trigger above isn't needed). Replace the profiles statements with:
-- create table if not exists public.one_health_links (
--   user_id uuid primary key references auth.users (id) on delete cascade,
--   one_health_env text not null,
--   one_health_tenant_id text not null,
--   one_health_user_id text not null,
--   unique (one_health_env, one_health_tenant_id, one_health_user_id)
-- );
-- alter table public.one_health_links enable row level security;
-- revoke all on public.one_health_links from anon, authenticated;
-- grant select, insert, update on public.one_health_links to service_role;
