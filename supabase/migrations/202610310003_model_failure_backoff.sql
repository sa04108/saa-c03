-- Apply after 202610310002_ai_cache_history_fallback.sql.
-- Existing account, study progress, suggestion cache and chat history stay intact.
begin;

alter table public.ai_model_cooldowns
  add column failure_count integer not null default 0 check (failure_count between 0 and 3),
  add column last_error text,
  add column last_attempt_started_at timestamptz;

-- Old rows represent provider quota failures. Start them at the first stage
-- with at most one minute left instead of retaining the old quota-reset wait.
update public.ai_model_cooldowns
  set failure_count = 1, last_error = 'http_429', retry_at = least(retry_at, now() + interval '1 minute')
  where retry_at > now();

create function public.record_ai_model_outcome(
  p_model text,
  p_attempt_started_at timestamptz,
  p_error text
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  state public.ai_model_cooldowns%rowtype;
  stamp timestamptz;
  failures integer;
  seconds integer;
begin
  if p_model is null or p_model !~ '^gemini-[a-zA-Z0-9.-]+$'
    or p_attempt_started_at is null or not isfinite(p_attempt_started_at)
    or p_attempt_started_at > now() + interval '1 minute'
    or (p_error is not null and p_error !~ '^(http_[45][0-9]{2}|timeout|network_or_response)$') then
    raise exception 'Invalid model outcome' using errcode = '22023';
  end if;

  insert into public.ai_model_cooldowns(model, retry_at)
    values (p_model, timestamptz 'epoch') on conflict (model) do nothing;
  select * into state from public.ai_model_cooldowns where model = p_model for update;
  stamp := clock_timestamp();

  -- A late outcome cannot undo the result of a more recently started attempt.
  if state.last_attempt_started_at is null or p_attempt_started_at > state.last_attempt_started_at then
    if p_error is null then
      update public.ai_model_cooldowns set failure_count = 0, last_error = null,
        retry_at = stamp, last_attempt_started_at = p_attempt_started_at
        where model = p_model returning * into state;
    elsif state.retry_at > stamp and state.failure_count > 0 then
      -- Multiple in-flight failures during one exclusion window are one stage.
      -- Record the newer attempt fence without extending the window or count.
      update public.ai_model_cooldowns set last_attempt_started_at = p_attempt_started_at
        where model = p_model returning * into state;
    else
      failures := least(state.failure_count + 1, 3);
      seconds := case failures when 1 then 60 when 2 then 3600 else 86400 end;
      update public.ai_model_cooldowns set failure_count = failures, last_error = p_error,
        retry_at = stamp + make_interval(secs => seconds), last_attempt_started_at = p_attempt_started_at
        where model = p_model returning * into state;
    end if;
  end if;

  return jsonb_build_object('failure_count', state.failure_count,
    'retry_at', state.retry_at, 'last_error', state.last_error);
end;
$$;

revoke all on function public.record_ai_model_outcome(text,timestamptz,text) from public, anon, authenticated;
grant execute on function public.record_ai_model_outcome(text,timestamptz,text) to service_role;

-- Older Edge Function instances can still finish requests during rollout.
-- Keep their RPC compatible without allowing it to restore day-long waits.
create or replace function public.record_ai_model_cooldown(p_model text, p_retry_at timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_retry_at is null or not isfinite(p_retry_at) or p_retry_at > now() + interval '8 days' then
    raise exception 'Invalid model cooldown' using errcode = '22023';
  end if;
  perform public.record_ai_model_outcome(p_model, clock_timestamp(), 'http_429');
end;
$$;
revoke all on function public.record_ai_model_cooldown(text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_ai_model_cooldown(text,timestamptz) to service_role;

-- The updated Edge Function uses only record_ai_model_outcome.
-- The table retains its existing server-only RLS/grants.
commit;
