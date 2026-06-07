-- QCM Edu AI backend schema
-- Run this in Supabase SQL editor. Keep service_role access on backend only.

create extension if not exists pgcrypto;

create table if not exists modules (
  id text primary key,
  name text not null,
  description text,
  level text,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists courses (
  id text primary key,
  module_id text not null references modules(id) on delete cascade,
  title text not null,
  summary text,
  keywords text[] not null default '{}',
  active boolean not null default true,
  storage_base_path text not null,
  total_chunks integer not null default 0,
  ready boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists course_chunks (
  id uuid primary key default gen_random_uuid(),
  module_id text not null references modules(id) on delete cascade,
  course_id text not null references courses(id) on delete cascade,
  chunk_index integer not null,
  storage_path text not null,
  summary text,
  keywords text[] not null default '{}',
  token_estimate integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(course_id, chunk_index)
);

create table if not exists users (
  id text primary key,
  email text,
  full_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_ai_keys (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  provider text not null,
  model text,
  encrypted_api_key text not null,
  key_mask text,
  active boolean not null default true,
  tested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, provider)
);

create table if not exists user_daily_usage (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  day date not null,
  used integer not null default 0,
  daily_limit integer not null default 5,
  last_request_at timestamptz,
  unique(user_id, day)
);

create table if not exists backend_servers (
  id text primary key,
  name text not null,
  type text not null,
  url text not null,
  enabled boolean not null default true,
  status text not null default 'healthy',
  daily_limit integer not null default 1000,
  max_concurrent integer not null default 3,
  current_concurrent integer not null default 0,
  priority integer not null default 100,
  supports_file_upload boolean not null default true,
  supports_text_only boolean not null default true,
  last_health_check timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists backend_daily_usage (
  id uuid primary key default gen_random_uuid(),
  backend_id text not null references backend_servers(id) on delete cascade,
  day date not null,
  used integer not null default 0,
  success integer not null default 0,
  failed integer not null default 0,
  "limit" integer not null default 1000,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(backend_id, day)
);

create table if not exists analysis_history (
  id uuid primary key default gen_random_uuid(),
  user_id text references users(id) on delete set null,
  module_id text references modules(id) on delete set null,
  course_ids text[] not null default '{}',
  provider text,
  model text,
  status text not null,
  result_preview text,
  full_result text,
  created_at timestamptz not null default now()
);

create or replace function consume_user_daily_quota(
  p_user_id text,
  p_daily_limit integer
)
returns table(allowed boolean, used integer, daily_limit integer)
language plpgsql
security definer
as $$
declare
  v_row user_daily_usage;
begin
  insert into user_daily_usage(user_id, day, used, daily_limit, last_request_at)
  values (p_user_id, current_date, 0, p_daily_limit, now())
  on conflict(user_id, day) do nothing;

  update user_daily_usage u
  set used = u.used + 1,
      daily_limit = p_daily_limit,
      last_request_at = now()
  where u.user_id = p_user_id
    and u.day = current_date
    and u.used < p_daily_limit
  returning u.* into v_row;

  if found then
    return query select true, v_row.used, v_row.daily_limit;
  else
    select u.* into v_row
    from user_daily_usage u
    where u.user_id = p_user_id and u.day = current_date;

    return query select false, coalesce(v_row.used, 0), p_daily_limit;
  end if;
end;
$$;

create or replace function reserve_ai_backend()
returns table(backend_id text, url text)
language plpgsql
security definer
as $$
declare
  v_backend backend_servers;
begin
  insert into backend_daily_usage(backend_id, day, used, success, failed, "limit")
  select bs.id, current_date, 0, 0, 0, bs.daily_limit
  from backend_servers bs
  where bs.enabled = true
  on conflict on constraint backend_daily_usage_backend_id_day_key do nothing;

  select bs.* into v_backend
  from backend_servers bs
  left join backend_daily_usage bdu
    on bdu.backend_id = bs.id and bdu.day = current_date
  where bs.enabled = true
    and bs.status = 'healthy'
    and bs.current_concurrent < bs.max_concurrent
    and coalesce(bdu.used, 0) < bs.daily_limit
  order by bs.priority asc,
           coalesce(bdu.used, 0) asc,
           bs.current_concurrent asc,
           bs.updated_at asc
  for update of bs skip locked
  limit 1;

  if not found then
    return;
  end if;

  update backend_servers bs
  set current_concurrent = bs.current_concurrent + 1,
      updated_at = now()
  where bs.id = v_backend.id;

  return query select v_backend.id, v_backend.url;
end;
$$;

create or replace function release_ai_backend(
  p_backend_id text,
  p_success boolean,
  p_count_usage boolean default true
)
returns void
language plpgsql
security definer
as $$
begin
  update backend_servers bs
  set current_concurrent = greatest(bs.current_concurrent - 1, 0),
      updated_at = now()
  where bs.id = p_backend_id;

  if p_count_usage then
    insert into backend_daily_usage(backend_id, day, used, success, failed, "limit")
    values (
      p_backend_id,
      current_date,
      1,
      case when p_success then 1 else 0 end,
      case when p_success then 0 else 1 end,
      coalesce((select bs.daily_limit from backend_servers bs where bs.id = p_backend_id), 1000)
    )
    on conflict on constraint backend_daily_usage_backend_id_day_key do update
    set used = backend_daily_usage.used + 1,
        success = backend_daily_usage.success + case when p_success then 1 else 0 end,
        failed = backend_daily_usage.failed + case when p_success then 0 else 1 end,
        updated_at = now();
  end if;
end;
$$;
