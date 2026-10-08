create extension if not exists pgcrypto with schema extensions;
-- pgcrypto optional; access codes use md5() built into PostgreSQL

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  role text not null check (role in ('parent', 'teacher', 'caregiver')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), split_part(new.email, '@', 1), 'User'),
    coalesce(nullif(new.raw_user_meta_data->>'role', ''), 'parent')
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create table public.children (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.users(id) on delete cascade,
  caregiver_id uuid references public.users(id) on delete set null,
  display_name text not null,
  functionality_level text not null default 'medium' check (functionality_level in ('low', 'medium', 'high')),
  teacher_email text,
  teacher_invite_sent_at timestamptz,
  dashboard_password_hash text,
  created_at timestamptz not null default now()
);

create table public.child_access_codes (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  code_hash text not null,
  label text not null default 'teacher access',
  is_active boolean not null default true,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);

create table public.symbol_categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  label text not null,
  emoji text not null,
  sort_order integer not null default 0
);

create table public.symbols (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.symbol_categories(id) on delete restrict,
  slug text not null unique,
  label text not null,
  emoji text not null,
  sort_order integer not null default 0
);

create table public.child_symbol_settings (
  child_id uuid not null references public.children(id) on delete cascade,
  symbol_id uuid references public.symbols(id) on delete cascade,
  category_id uuid references public.symbol_categories(id) on delete cascade,
  is_hidden boolean not null default false,
  is_favorite boolean not null default false,
  is_core boolean not null default false,
  is_category_enabled boolean not null default true,
  primary key (child_id, symbol_id, category_id),
  check (symbol_id is not null or category_id is not null)
);

create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  event_type text not null check (event_type in ('school', 'trip', 'birthday', 'family', 'special')),
  title text not null,
  event_date date not null,
  created_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.weekly_topics (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  topic_slug text not null,
  label text not null,
  week_starts_on date not null,
  selected_by uuid not null references public.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table public.communication_sessions (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);

create table public.communication_entries (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.communication_sessions(id) on delete cascade,
  child_id uuid not null references public.children(id) on delete cascade,
  spoken_text text not null,
  sentence_length integer not null check (sentence_length >= 0),
  created_at timestamptz not null default now()
);

create table public.suggested_prompts (
  id uuid primary key default gen_random_uuid(),
  child_id uuid not null references public.children(id) on delete cascade,
  prompt_text text not null,
  reason text not null,
  score integer not null default 0,
  created_at timestamptz not null default now()
);

alter table public.users enable row level security;
alter table public.children enable row level security;
alter table public.child_access_codes enable row level security;
alter table public.symbol_categories enable row level security;
alter table public.symbols enable row level security;
alter table public.child_symbol_settings enable row level security;
alter table public.calendar_events enable row level security;
alter table public.weekly_topics enable row level security;
alter table public.communication_sessions enable row level security;
alter table public.communication_entries enable row level security;
alter table public.suggested_prompts enable row level security;

create or replace function public.can_access_child(child_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.children c
    where c.id = child_uuid
      and (c.parent_id = auth.uid() or c.caregiver_id = auth.uid())
  );
$$;

create policy "users can read self"
on public.users for select
using (id = auth.uid());

create policy "users can insert self"
on public.users for insert
with check (id = auth.uid());

create policy "users can update self"
on public.users for update
using (id = auth.uid())
with check (id = auth.uid());

create policy "care team can read children"
on public.children for select
using (parent_id = auth.uid() or caregiver_id = auth.uid());

create policy "parents can create children"
on public.children for insert
with check (parent_id = auth.uid());

create policy "care team can update children"
on public.children for update
using (parent_id = auth.uid() or caregiver_id = auth.uid())
with check (parent_id = auth.uid() or caregiver_id = auth.uid());

create policy "care team manages child access codes"
on public.child_access_codes for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

create or replace function public.get_or_create_parent_child(
  display_name_value text,
  functionality_level_value text default 'medium'
)
returns table (id uuid, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.users (id, full_name, role)
  select
    auth.uid(),
    coalesce(nullif(u.full_name, ''), 'הורה'),
    coalesce(nullif(u.role, ''), 'parent')
  from public.users u
  where u.id = auth.uid()
  union all
  select auth.uid(), 'הורה', 'parent'
  where not exists (select 1 from public.users u2 where u2.id = auth.uid())
  on conflict (id) do nothing;

  return query
  select c.id, c.display_name
  from public.children c
  where c.parent_id = auth.uid()
  order by c.created_at
  limit 1;

  if found then
    return;
  end if;

  return query
  insert into public.children (parent_id, display_name, functionality_level)
  values (
    auth.uid(),
    coalesce(nullif(trim(display_name_value), ''), 'דניאל'),
    coalesce(nullif(functionality_level_value, ''), 'medium')
  )
  returning children.id, children.display_name;
end;
$$;

create or replace function public.create_child_access_code(
  child_uuid uuid,
  raw_code text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  code_uuid uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  if length(trim(raw_code)) < 6 then
    raise exception 'code must be at least 6 characters';
  end if;

  if not public.can_access_child(child_uuid) then
    raise exception 'not allowed';
  end if;

  update public.child_access_codes
  set is_active = false
  where child_id = child_uuid;

  insert into public.child_access_codes (child_id, code_hash, created_by)
  values (child_uuid, md5(trim(raw_code)), auth.uid())
  returning id into code_uuid;

  return code_uuid;
end;
$$;

create or replace function public.claim_child_access_code(
  raw_code text,
  teacher_full_name text default 'Teacher'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_child_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select child_id
  into matched_child_id
  from public.child_access_codes
  where is_active = true
    and (expires_at is null or expires_at > now())
    and code_hash = md5(trim(raw_code))
  order by created_at desc
  limit 1;

  if matched_child_id is null then
    raise exception 'invalid child access code';
  end if;

  insert into public.users (id, full_name, role)
  values (auth.uid(), coalesce(nullif(trim(teacher_full_name), ''), 'Teacher'), 'teacher')
  on conflict (id) do nothing;

  update public.children
  set caregiver_id = auth.uid()
  where id = matched_child_id;

  return matched_child_id;
end;
$$;

create policy "public symbol library readable"
on public.symbol_categories for select
using (true);

create policy "public symbols readable"
on public.symbols for select
using (true);

create policy "care team manages symbol settings"
on public.child_symbol_settings for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

create policy "care team manages events"
on public.calendar_events for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

create policy "care team manages weekly topics"
on public.weekly_topics for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

create policy "care team manages sessions"
on public.communication_sessions for all
using (public.can_access_child(child_id))
with check (public.can_access_child(child_id));

create policy "care team reads entries"
on public.communication_entries for select
using (public.can_access_child(child_id));

create policy "care team inserts entries"
on public.communication_entries for insert
with check (public.can_access_child(child_id));

create policy "care team reads suggested prompts"
on public.suggested_prompts for select
using (public.can_access_child(child_id));

create policy "care team inserts suggested prompts"
on public.suggested_prompts for insert
with check (public.can_access_child(child_id));

grant execute on function public.get_or_create_parent_child(text, text) to authenticated;
grant execute on function public.create_child_access_code(uuid, text) to authenticated;
grant execute on function public.claim_child_access_code(text, text) to authenticated;

create table if not exists public.child_caregivers (
  child_id uuid not null references public.children(id) on delete cascade,
  caregiver_id uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (child_id, caregiver_id)
);

alter table public.child_caregivers enable row level security;

drop policy if exists "caregivers read own links" on public.child_caregivers;
create policy "caregivers read own links"
on public.child_caregivers for select
using (caregiver_id = auth.uid());

drop policy if exists "parents read child caregivers" on public.child_caregivers;
create policy "parents read child caregivers"
on public.child_caregivers for select
using (
  exists (
    select 1
    from public.children c
    where c.id = child_id and c.parent_id = auth.uid()
  )
);

create or replace function public.can_access_child(child_uuid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.children c
    where c.id = child_uuid
      and (
        c.parent_id = auth.uid()
        or c.caregiver_id = auth.uid()
        or exists (
          select 1
          from public.child_caregivers cc
          where cc.child_id = c.id and cc.caregiver_id = auth.uid()
        )
      )
  );
$$;

create or replace function public.claim_child_access_code(
  raw_code text,
  teacher_full_name text default 'Teacher'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  matched_child_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  select child_id
  into matched_child_id
  from public.child_access_codes
  where is_active = true
    and (expires_at is null or expires_at > now())
    and code_hash = md5(trim(raw_code))
  order by created_at desc
  limit 1;

  if matched_child_id is null then
    raise exception 'invalid child access code';
  end if;

  insert into public.users (id, full_name, role)
  values (auth.uid(), coalesce(nullif(trim(teacher_full_name), ''), 'Teacher'), 'teacher')
  on conflict (id) do nothing;

  insert into public.child_caregivers (child_id, caregiver_id)
  values (matched_child_id, auth.uid())
  on conflict (child_id, caregiver_id) do nothing;

  update public.children
  set caregiver_id = auth.uid()
  where id = matched_child_id;

  return matched_child_id;
end;
$$;

notify pgrst, 'reload schema';
