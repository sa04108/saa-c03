begin;

-- Only the Edge Function's service role can access these tables or reserve budget.
create table public.ai_suggestion_cache (
  cache_key text primary key check (cache_key ~ '^[a-f0-9]{64}$'),
  questions jsonb not null check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) = 4),
  expires_at timestamptz not null
);
create index ai_suggestion_cache_expiry on public.ai_suggestion_cache (expires_at);
alter table public.ai_suggestion_cache enable row level security;
revoke all on public.ai_suggestion_cache from public, anon, authenticated;
grant all on public.ai_suggestion_cache to service_role;

create table public.ai_usage_windows (
  scope text not null,
  window_start timestamptz not null,
  used integer not null default 0 check (used >= 0),
  expires_at timestamptz not null,
  primary key (scope, window_start)
);
create index ai_usage_windows_expiry on public.ai_usage_windows (expires_at);
alter table public.ai_usage_windows enable row level security;
revoke all on public.ai_usage_windows from public, anon, authenticated;
grant all on public.ai_usage_windows to service_role;

create function public.reserve_ai_request(
  p_user_id uuid,
  p_global_minute integer,
  p_global_day integer,
  p_user_day integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  stamp timestamptz := now();
  minute_start timestamptz := date_trunc('minute', stamp);
  day_start timestamptz := date_trunc('day', stamp at time zone 'UTC') at time zone 'UTC';
  scopes text[];
  starts timestamptz[];
  ends timestamptz[];
  limits integer[];
  used_count integer;
  i integer;
begin
  if p_user_id is null or p_global_minute is null or p_global_day is null or p_user_day is null
    or p_global_minute not between 1 and 1000 or p_global_day not between 1 and 100000
    or p_user_day not between 1 and 10000 then
    raise exception 'Invalid AI budget' using errcode = '22023';
  end if;
  -- One short transaction checks and consumes all limits, even across isolates.
  perform pg_advisory_xact_lock(7310312026::bigint);
  scopes := array['global:minute', 'global:day', 'user:' || p_user_id::text];
  starts := array[minute_start, day_start, day_start];
  ends := array[minute_start + interval '1 minute', day_start + interval '1 day', day_start + interval '1 day'];
  limits := array[p_global_minute, p_global_day, p_user_day];
  for i in 1..3 loop
    select used into used_count from public.ai_usage_windows
      where scope = scopes[i] and window_start = starts[i];
    if coalesce(used_count, 0) >= limits[i] then
      return jsonb_build_object('allowed', false, 'retryAfter', greatest(1, ceil(extract(epoch from ends[i] - stamp))::integer));
    end if;
  end loop;
  for i in 1..3 loop
    insert into public.ai_usage_windows (scope, window_start, used, expires_at)
      values (scopes[i], starts[i], 1, ends[i])
      on conflict (scope, window_start) do update set used = public.ai_usage_windows.used + 1;
  end loop;
  delete from public.ai_usage_windows where expires_at < stamp - interval '2 days';
  delete from public.ai_suggestion_cache where expires_at < stamp;
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.reserve_ai_request(uuid,integer,integer,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_request(uuid,integer,integer,integer) to service_role;

-- Anonymous AI sessions must not acquire access to cloud progress storage.
alter policy "Read own study progress" on public.study_progress
  using ((select auth.uid()) = user_id and coalesce((select auth.jwt())->>'is_anonymous', 'false') <> 'true');

alter function public.save_study_progress(uuid,text,bigint,jsonb) rename to save_study_progress_member;
revoke all on function public.save_study_progress_member(uuid,text,bigint,jsonb) from public, anon, authenticated;
create function public.save_study_progress(
  p_user_id uuid, p_bank_id text, p_expected_revision bigint, p_state jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  return public.save_study_progress_member(p_user_id, p_bank_id, p_expected_revision, p_state);
end;
$$;
revoke all on function public.save_study_progress(uuid,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_study_progress(uuid,text,bigint,jsonb) to authenticated;

commit;
