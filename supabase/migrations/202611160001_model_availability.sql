-- Apply once through the existing deployment workflow, before the Edge Function.
begin;

alter table public.ai_model_cooldowns rename column retry_at to available_at;
comment on column public.ai_model_cooldowns.available_at is
  'The earliest time this model may be attempted again after a confirmed failure.';

-- Old timeouts came from the short latency/processing budgets. They must not
-- keep models excluded under the new policy. Preserve real HTTP/network errors
-- and all cumulative success counts.
update public.ai_model_cooldowns
set failure_count = 0, last_error = null, available_at = clock_timestamp(),
    last_attempt_started_at = clock_timestamp()
where last_error = 'timeout';

drop function public.record_ai_model_cooldown(text,timestamp with time zone);
create function public.record_ai_model_cooldown(p_model text, p_available_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_available_at is null or not isfinite(p_available_at) or p_available_at > now() + interval '8 days' then
    raise exception 'Invalid model cooldown' using errcode = '22023';
  end if;
  perform public.record_ai_model_outcome(p_model, clock_timestamp(), 'http_429');
end;
$function$;
revoke all on function public.record_ai_model_cooldown(text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.record_ai_model_cooldown(text,timestamp with time zone) to service_role;

create or replace function public.record_ai_model_outcome(p_model text, p_attempt_started_at timestamp with time zone, p_error text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  insert into public.ai_model_cooldowns(model, available_at)
    values (p_model, timestamptz 'epoch') on conflict (model) do nothing;
  select * into state from public.ai_model_cooldowns where model = p_model for update;
  stamp := clock_timestamp();

  -- A late outcome cannot undo the result of a more recently started attempt.
  if state.last_attempt_started_at is null or p_attempt_started_at > state.last_attempt_started_at then
    if p_error is null then
      update public.ai_model_cooldowns set failure_count = 0, last_error = null,
        available_at = stamp, last_attempt_started_at = p_attempt_started_at
        where model = p_model returning * into state;
    elsif state.available_at > stamp and state.failure_count > 0 then
      -- Multiple in-flight failures during one exclusion window are one stage.
      -- Record the newer attempt fence without extending the window or count.
      update public.ai_model_cooldowns set last_attempt_started_at = p_attempt_started_at
        where model = p_model returning * into state;
    else
      failures := least(state.failure_count + 1, 3);
      seconds := case failures when 1 then 60 when 2 then 3600 else 86400 end;
      update public.ai_model_cooldowns set failure_count = failures, last_error = p_error,
        available_at = stamp + make_interval(secs => seconds), last_attempt_started_at = p_attempt_started_at
        where model = p_model returning * into state;
    end if;
  end if;

  return jsonb_build_object('failure_count', state.failure_count,
    'available_at', state.available_at, 'last_error', state.last_error);
end;
$function$;
revoke all on function public.record_ai_model_outcome(text,timestamp with time zone,text) from public, anon, authenticated;
grant execute on function public.record_ai_model_outcome(text,timestamp with time zone,text) to service_role;

-- A completed answer is a success regardless of time to its first token.
-- The existing attempt timestamp fence prevents an older completion from
-- clearing the failure of a more recently started request.
drop function public.record_ai_model_success(text,timestamp with time zone,boolean);
create function public.record_ai_model_success(
  p_model text,
  p_attempt_started_at timestamp with time zone
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  state public.ai_model_cooldowns%rowtype;
begin
  if p_model is null or p_model !~ '^gemini-[a-zA-Z0-9.-]+$'
    or p_attempt_started_at is null or not isfinite(p_attempt_started_at)
    or p_attempt_started_at > now() + interval '1 minute' then
    raise exception 'Invalid model success' using errcode = '22023';
  end if;

  insert into public.ai_model_cooldowns(model, available_at, success_count)
    values (p_model, timestamptz 'epoch', 1)
    on conflict (model) do update
      set success_count = public.ai_model_cooldowns.success_count + 1
    returning * into state;

  return public.record_ai_model_outcome(p_model, p_attempt_started_at, null)
    || jsonb_build_object('success_count', state.success_count);
end;
$function$;
revoke all on function public.record_ai_model_success(text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.record_ai_model_success(text,timestamp with time zone) to service_role;

commit;
