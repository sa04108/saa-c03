alter table public.ai_model_cooldowns
  add column success_count bigint not null default 0
  constraint ai_model_cooldowns_success_count_check check (success_count >= 0);

comment on column public.ai_model_cooldowns.success_count is
  'Cumulative completed model responses since this counter was introduced; excludes cache hits and cancelled attempts.';

create function public.record_ai_model_success(
  p_model text,
  p_attempt_started_at timestamp with time zone,
  p_preserve_cooldown boolean default false
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
    or p_attempt_started_at > now() + interval '1 minute'
    or p_preserve_cooldown is null then
    raise exception 'Invalid model success' using errcode = '22023';
  end if;

  -- Count older concurrent completions too, independently of the cooldown fence.
  insert into public.ai_model_cooldowns(model, retry_at, success_count)
    values (p_model, timestamptz 'epoch', 1)
    on conflict (model) do update
      set success_count = public.ai_model_cooldowns.success_count + 1
    returning * into state;

  if not p_preserve_cooldown then
    return public.record_ai_model_outcome(p_model, p_attempt_started_at, null)
      || jsonb_build_object('success_count', state.success_count);
  end if;

  -- A response arriving after five seconds still counts, without clearing its penalty.
  return jsonb_build_object('success_count', state.success_count,
    'failure_count', state.failure_count, 'retry_at', state.retry_at, 'last_error', state.last_error);
end;
$function$;

revoke all on function public.record_ai_model_success(text,timestamp with time zone,boolean) from public, anon, authenticated;
grant execute on function public.record_ai_model_success(text,timestamp with time zone,boolean) to service_role;
