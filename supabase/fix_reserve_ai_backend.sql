create or replace function reserve_ai_backend()
returns table(backend_id text, url text)
language plpgsql
security definer
as $$
#variable_conflict use_column
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

  return query select v_backend.id::text, v_backend.url::text;
end;
$$;
