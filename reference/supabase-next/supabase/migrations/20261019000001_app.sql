-- Test app schema: a profiles table mirroring auth.users (the common Supabase pattern) and a sign-up gate,
-- so the 1health templates run against the same shapes a real repo has.
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
create policy "own profile" on public.profiles for select using (auth.uid() = id);
grant select, update on public.profiles to service_role;

create function public.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, lower(new.email), new.raw_user_meta_data ->> 'name');
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

-- Sign-up gate (like Carrier's signup_domain hook): only these domains may create accounts.
create table public.allowed_signup_domains (domain text primary key);
insert into public.allowed_signup_domains values ('tachin.ai'), ('example.test');
create function public.enforce_signup_domain() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.allowed_signup_domains where domain = split_part(lower(new.email), '@', 2)) then
    raise exception 'Account creation is not available for this email address.';
  end if;
  return new;
end $$;
create trigger enforce_signup_domain before insert on auth.users for each row execute function public.enforce_signup_domain();
