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

-- Google enforces the shared project/model RPM, RPD and TPM. The only local
-- request budget is the anonymous user's UTC-day allowance.
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
  -- Serialize reservations so simultaneous guest requests cannot exceed the allowance.
  perform pg_advisory_xact_lock(7310312026::bigint);
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
