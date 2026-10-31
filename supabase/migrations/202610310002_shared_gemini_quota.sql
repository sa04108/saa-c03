begin;

-- Google enforces the shared project/model RPM, RPD and TPM. The only local
-- request budget is the existing anonymous user's UTC-day allowance.
create function public.reserve_ai_guest_request(
  p_user_id uuid,
  p_user_day integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  stamp timestamptz := now();
  day_start timestamptz := date_trunc('day', stamp at time zone 'UTC') at time zone 'UTC';
  day_end timestamptz := day_start + interval '1 day';
  user_scope text := 'user:' || p_user_id::text;
  used_count integer;
begin
  if p_user_id is null or p_user_day is null or p_user_day not between 1 and 10000 then
    raise exception 'Invalid guest AI budget' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous is true) then
    raise exception 'An anonymous AI session is required' using errcode = '42501';
  end if;
  -- Retain the original reservation lock so in-flight pre-migration calls
  -- cannot race a guest reservation during deployment. Members skip this RPC.
  perform pg_advisory_xact_lock(7310312026::bigint);
  -- Reuse the existing scope so a deployment does not reset today's guest usage.
  select used into used_count from public.ai_usage_windows
    where scope = user_scope and window_start = day_start;
  if coalesce(used_count, 0) >= p_user_day then
    return jsonb_build_object('allowed', false, 'retryAfter', greatest(1, ceil(extract(epoch from day_end - stamp))::integer));
  end if;
  insert into public.ai_usage_windows (scope, window_start, used, expires_at)
    values (user_scope, day_start, 1, day_end)
    on conflict (scope, window_start) do update set used = public.ai_usage_windows.used + 1;
  delete from public.ai_usage_windows where expires_at < stamp - interval '2 days';
  delete from public.ai_suggestion_cache where expires_at < stamp;
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.reserve_ai_guest_request(uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_guest_request(uuid,integer) to service_role;

-- Keep the old signature working during deployment. Its global arguments and
-- linked-account budget are intentionally ignored, even by the old Edge code.
create or replace function public.reserve_ai_request(
  p_user_id uuid,
  p_global_minute integer,
  p_global_day integer,
  p_user_day integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  guest boolean;
begin
  select is_anonymous into guest from auth.users where id = p_user_id;
  if not found then
    raise exception 'Unknown AI user' using errcode = '42501';
  end if;
  if guest is true then
    return public.reserve_ai_guest_request(p_user_id, p_user_day);
  end if;
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.reserve_ai_request(uuid,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid,integer,integer,integer) to service_role;

commit;
