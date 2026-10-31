begin;

-- Legacy hashes cannot be mapped back to item IDs. Reset only derived questions;
-- account progress and anonymous request counters are preserved.
truncate table public.ai_suggestion_cache;
alter table public.ai_suggestion_cache
  drop column cache_key,
  drop column expires_at,
  alter column questions drop not null,
  add column context_id text primary key check (length(context_id) between 1 and 180 and context_id ~ '^[a-zA-Z0-9:/_.-]+$'),
  add column model text not null check (model ~ '^gemini-[a-zA-Z0-9.-]+$'),
  add column prompt_version text not null check (length(prompt_version) between 1 and 80),
  add column content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  add column generation_id uuid not null;

-- Keep the existing guest allowance, but never expire suggestion rows by time.
create or replace function public.reserve_ai_guest_request(
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
  return jsonb_build_object('allowed', true);
end;
$$;
revoke all on function public.reserve_ai_guest_request(uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_guest_request(uuid,integer) to service_role;

-- One row per item, shared by every user. Metadata is for invalidation only.
-- Clear an obsolete list before generation and use a token to reject late writes.
create function public.prepare_ai_suggestions(
  p_context_id text,
  p_model text,
  p_prompt_version text,
  p_content_hash text,
  p_user_id uuid,
  p_guest_day integer
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  cached public.ai_suggestion_cache%rowtype;
  is_guest boolean;
  reservation jsonb;
  token uuid;
begin
  if p_context_id is null or length(p_context_id) not between 1 and 180 or p_context_id !~ '^[a-zA-Z0-9:/_.-]+$'
    or p_model is null or p_model !~ '^gemini-[a-zA-Z0-9.-]+$'
    or p_prompt_version is null or length(p_prompt_version) not between 1 and 80
    or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{64}$' then
    raise exception 'Invalid suggestion metadata' using errcode = '22023';
  end if;
  select is_anonymous into is_guest from auth.users where id = p_user_id;
  if not found then
    raise exception 'An AI session is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('ai-suggestions:' || p_context_id, 0));
  select * into cached from public.ai_suggestion_cache where context_id = p_context_id;
  if found and cached.model = p_model and cached.prompt_version = p_prompt_version
    and cached.content_hash = p_content_hash and cached.questions is not null then
    return jsonb_build_object('allowed', true, 'cached', true, 'questions', cached.questions);
  end if;
  -- A hit is free. A denied guest miss must not clear or create shared cache rows.
  if is_guest is true then
    reservation := public.reserve_ai_guest_request(p_user_id, p_guest_day);
    if reservation->>'allowed' <> 'true' then
      return reservation;
    end if;
  end if;
  if cached.context_id is not null and cached.model = p_model
    and cached.prompt_version = p_prompt_version and cached.content_hash = p_content_hash then
    token := cached.generation_id;
  else
    token := gen_random_uuid();
    insert into public.ai_suggestion_cache (context_id, model, prompt_version, content_hash, generation_id, questions)
      values (p_context_id, p_model, p_prompt_version, p_content_hash, token, null)
      on conflict (context_id) do update set
        model = excluded.model, prompt_version = excluded.prompt_version,
        content_hash = excluded.content_hash, generation_id = excluded.generation_id, questions = null;
  end if;
  return jsonb_build_object('allowed', true, 'cached', false, 'generation_id', token);
end;
$$;
revoke all on function public.prepare_ai_suggestions(text,text,text,text,uuid,integer) from public, anon, authenticated;
grant execute on function public.prepare_ai_suggestions(text,text,text,text,uuid,integer) to service_role;

commit;
