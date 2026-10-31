-- Initial application schema, consolidated from the six migrations deployed through 202610310005.
-- New databases only: deployment skips this file when that version is already applied.
-- Requires Supabase Auth (auth.users, auth.uid(), auth.jwt()) and its standard roles.
-- Existing project data is preserved by reconciling migration history, never rerunning this SQL.
begin;

create table public.study_progress (
  user_id uuid not null,
  bank_id text not null,
  revision bigint not null,
  state jsonb not null,
  updated_at timestamp with time zone default now() not null,
  constraint study_progress_bank_id_check CHECK ((bank_id = 'saa-c03-684-20260926-v1'::text)),
  constraint study_progress_pkey PRIMARY KEY (user_id, bank_id),
  constraint study_progress_revision_check CHECK ((revision > 0)),
  constraint study_progress_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.study_progress enable row level security;
revoke all on table public.study_progress from public, anon, authenticated;
grant select on table public.study_progress to authenticated;

create table public.ai_suggestion_cache (
  questions jsonb,
  context_id text not null,
  model text not null,
  prompt_version text not null,
  content_hash text not null,
  generation_id uuid not null,
  constraint ai_suggestion_cache_content_hash_check CHECK ((content_hash ~ '^[a-f0-9]{64}$'::text)),
  constraint ai_suggestion_cache_context_id_check CHECK (length(context_id) between 1 and 180 and context_id ~ '^[a-zA-Z0-9:/_.-]+$'),
  constraint ai_suggestion_cache_model_check CHECK ((model ~ '^gemini-[a-zA-Z0-9.-]+$'::text)),
  constraint ai_suggestion_cache_pkey PRIMARY KEY (context_id),
  constraint ai_suggestion_cache_prompt_version_check CHECK (((length(prompt_version) >= 1) AND (length(prompt_version) <= 80))),
  constraint ai_suggestion_cache_questions_check CHECK (((jsonb_typeof(questions) = 'array'::text) AND (jsonb_array_length(questions) = 4)))
);
alter table public.ai_suggestion_cache enable row level security;
revoke all on table public.ai_suggestion_cache from public, anon, authenticated;
grant all on table public.ai_suggestion_cache to service_role;

create table public.ai_usage_windows (
  scope text not null,
  window_start timestamp with time zone not null,
  used integer default 0 not null,
  expires_at timestamp with time zone not null,
  constraint ai_usage_windows_pkey PRIMARY KEY (scope, window_start),
  constraint ai_usage_windows_used_check CHECK ((used >= 0))
);
alter table public.ai_usage_windows enable row level security;
revoke all on table public.ai_usage_windows from public, anon, authenticated;
grant all on table public.ai_usage_windows to service_role;

create table public.ai_model_cooldowns (
  model text not null,
  retry_at timestamp with time zone not null,
  failure_count integer default 0 not null,
  last_error text,
  last_attempt_started_at timestamp with time zone,
  constraint ai_model_cooldowns_failure_count_check CHECK (((failure_count >= 0) AND (failure_count <= 3))),
  constraint ai_model_cooldowns_model_check CHECK ((model ~ '^gemini-[a-zA-Z0-9.-]+$'::text)),
  constraint ai_model_cooldowns_pkey PRIMARY KEY (model)
);
alter table public.ai_model_cooldowns enable row level security;
revoke all on table public.ai_model_cooldowns from public, anon, authenticated;
grant all on table public.ai_model_cooldowns to service_role;

create table public.ai_conversations (
  id uuid not null,
  user_id uuid not null,
  title text not null,
  context jsonb not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  last_turn_seq bigint default 0 not null,
  summary jsonb,
  summary_through_seq bigint default 0 not null,
  summary_revision integer default 0 not null,
  summary_model text,
  summary_prompt_version text,
  summary_job_id uuid,
  summary_job_through_seq bigint,
  summary_lease_until timestamp with time zone,
  summary_retry_after timestamp with time zone default '1970-01-01 00:00:00+00'::timestamp with time zone not null,
  constraint ai_conversations_pkey PRIMARY KEY (id),
  constraint ai_conversations_title_check CHECK (((length(title) >= 1) AND (length(title) <= 100))),
  constraint ai_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint ai_summary_range CHECK (((summary_through_seq >= 0) AND (summary_through_seq <= last_turn_seq))),
  constraint ai_summary_size CHECK (((summary IS NULL) OR ((jsonb_typeof(summary) = 'object'::text) AND (octet_length((summary)::text) <= 24000))))
);
alter table public.ai_conversations enable row level security;
revoke all on table public.ai_conversations from public, anon, authenticated;
grant select on table public.ai_conversations to authenticated;

create table public.ai_chat_turns (
  id uuid not null,
  conversation_id uuid not null,
  question text not null,
  answer text not null,
  created_at timestamp with time zone not null,
  turn_seq bigint not null,
  constraint ai_chat_turns_answer_check CHECK (((length(btrim(answer)) >= 1) AND (length(btrim(answer)) <= 14000))),
  constraint ai_chat_turns_conversation_id_fkey FOREIGN KEY (conversation_id) REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  constraint ai_chat_turns_pkey PRIMARY KEY (id),
  constraint ai_chat_turns_question_check CHECK (((length(btrim(question)) >= 1) AND (length(btrim(question)) <= 2000)))
);
alter table public.ai_chat_turns enable row level security;
revoke all on table public.ai_chat_turns from public, anon, authenticated;
grant select on table public.ai_chat_turns to authenticated;

create table public.ai_deleted_conversations (
  id uuid not null,
  user_id uuid not null,
  constraint ai_deleted_conversations_pkey PRIMARY KEY (id),
  constraint ai_deleted_conversations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE
);
alter table public.ai_deleted_conversations enable row level security;
revoke all on table public.ai_deleted_conversations from public, anon, authenticated;
grant all on table public.ai_deleted_conversations to service_role;

-- Indexes and account-scoped reads.
CREATE INDEX ai_chat_turns_conversation_created ON public.ai_chat_turns USING btree (conversation_id, created_at DESC, id DESC);
CREATE UNIQUE INDEX ai_chat_turns_sequence ON public.ai_chat_turns USING btree (conversation_id, turn_seq);
CREATE INDEX ai_conversations_owner_updated ON public.ai_conversations USING btree (user_id, updated_at DESC, id DESC);
CREATE INDEX ai_usage_windows_expiry ON public.ai_usage_windows USING btree (expires_at);
create policy "Read own AI chat turns" on public.ai_chat_turns as permissive for select to "authenticated"
  using (((COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text) AND (EXISTS ( SELECT 1
   FROM public.ai_conversations c
  WHERE ((c.id = ai_chat_turns.conversation_id) AND (c.user_id = ( SELECT auth.uid() AS uid)))))));
create policy "Read own AI conversations" on public.ai_conversations as permissive for select to "authenticated"
  using (((user_id = ( SELECT auth.uid() AS uid)) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text)));
create policy "Read own study progress" on public.study_progress as permissive for select to "authenticated"
  using (((( SELECT auth.uid() AS uid) = user_id) AND (COALESCE((( SELECT auth.jwt() AS jwt) ->> 'is_anonymous'::text), 'false'::text) <> 'true'::text)));

-- Progress, guest requests, suggestion cache, model routing and session history RPCs.
create function public.claim_ai_compaction(p_conversation_id uuid, p_user_id uuid, p_force boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.ai_conversations%rowtype; stamp timestamptz := clock_timestamp(); token uuid; keep_turns integer := case when p_force then 1 else 3 end;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  select * into c from public.ai_conversations where id = p_conversation_id and user_id = p_user_id for update;
  if not found or c.last_turn_seq - c.summary_through_seq < (case when p_force then 2 else 7 end)
    or c.summary_retry_after > stamp or c.summary_lease_until > stamp then return null; end if;
  token := gen_random_uuid();
  update public.ai_conversations set summary_job_id = token,
    summary_job_through_seq = c.last_turn_seq - keep_turns, summary_lease_until = stamp + interval '60 seconds'
    where id = c.id;
  return jsonb_build_object('job_id', token, 'revision', c.summary_revision,
    'summary', c.summary, 'through_seq', c.summary_through_seq,
    'turns', (select jsonb_agg(to_jsonb(t) order by t.turn_seq) from (
      select turn_seq, question, answer from public.ai_chat_turns
      where conversation_id = c.id and turn_seq > c.summary_through_seq and turn_seq <= c.last_turn_seq - keep_turns
      order by turn_seq limit 32
    ) t));
end;
$function$;
revoke all on function public.claim_ai_compaction(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.claim_ai_compaction(uuid,uuid,boolean) to service_role;

create function public.delete_ai_conversations(p_ids uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner_id uuid := auth.uid(); target uuid; removed uuid[] := '{}';
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from auth.users where id = owner_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  if p_ids is null or cardinality(p_ids) not between 1 and 200 or array_position(p_ids, null) is not null then
    raise exception 'Invalid conversation selection' using errcode = '22023';
  end if;
  -- Stable lock ordering also serializes overlapping batches from two devices.
  for target in select distinct value from unnest(p_ids) as selected(value) order by value loop
    perform pg_advisory_xact_lock(hashtextextended('ai-conversation:' || target::text, 0));
    if exists (select 1 from public.ai_conversations where id = target and user_id = owner_id)
      or exists (select 1 from public.ai_deleted_conversations where id = target and user_id = owner_id) then
      insert into public.ai_deleted_conversations(id, user_id) values (target, owner_id) on conflict (id) do nothing;
      -- ai_chat_turns cascades; the parent contains the context and summary.
      delete from public.ai_conversations where id = target and user_id = owner_id;
      removed := array_append(removed, target);
    end if;
  end loop;
  return jsonb_build_object('deletedIds', removed);
end;
$function$;
revoke all on function public.delete_ai_conversations(uuid[]) from public, anon, authenticated;
grant execute on function public.delete_ai_conversations(uuid[]) to authenticated;

create function public.finish_ai_compaction(p_conversation_id uuid, p_user_id uuid, p_job_id uuid, p_revision integer, p_through_seq bigint, p_summary jsonb, p_model text, p_prompt_version text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c public.ai_conversations%rowtype;
begin
  select * into c from public.ai_conversations where id = p_conversation_id and user_id = p_user_id for update;
  if not found or c.summary_job_id is distinct from p_job_id or c.summary_revision is distinct from p_revision
    or c.summary_lease_until <= clock_timestamp() or c.summary_job_id is null then return false; end if;
  if p_summary is not null then
    if p_through_seq is null or p_through_seq <= c.summary_through_seq or p_through_seq > c.summary_job_through_seq
      or jsonb_typeof(p_summary) <> 'object' or octet_length(p_summary::text) > 24000
      or p_model is null or p_model !~ '^gemini-[a-zA-Z0-9.-]+$'
      or p_prompt_version is null or length(p_prompt_version) not between 1 and 80 then
      raise exception 'Invalid AI summary' using errcode = '22023';
    end if;
    update public.ai_conversations set summary = p_summary, summary_through_seq = p_through_seq,
      summary_revision = summary_revision + 1, summary_model = p_model, summary_prompt_version = p_prompt_version
      where id = c.id;
  end if;
  update public.ai_conversations set summary_job_id = null, summary_job_through_seq = null, summary_lease_until = null,
    summary_retry_after = case when p_summary is null then clock_timestamp() + interval '1 minute' else 'epoch'::timestamptz end
    where id = c.id;
  return true;
end;
$function$;
revoke all on function public.finish_ai_compaction(uuid,uuid,uuid,integer,bigint,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.finish_ai_compaction(uuid,uuid,uuid,integer,bigint,jsonb,text,text) to service_role;

create function public.guard_deleted_ai_conversation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- INSERT ... ON CONFLICT in save_ai_chat_turn always runs this trigger,
  -- including saves to existing sessions. Deletion takes the same lock first.
  perform pg_advisory_xact_lock(hashtextextended('ai-conversation:' || new.id::text, 0));
  if exists (select 1 from public.ai_deleted_conversations where id = new.id) then
    raise exception 'AI conversation deleted' using errcode = 'P0002';
  end if;
  return new;
end;
$function$;
revoke all on function public.guard_deleted_ai_conversation() from public, anon, authenticated;

create function public.list_ai_conversation_selection()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from auth.users where id = owner_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'updated_at', updated_at) order by id), '[]'::jsonb)
    from public.ai_conversations where user_id = owner_id);
end;
$function$;
revoke all on function public.list_ai_conversation_selection() from public, anon, authenticated;
grant execute on function public.list_ai_conversation_selection() to authenticated;

create function public.prepare_ai_suggestions(p_context_id text, p_model text, p_prompt_version text, p_content_hash text, p_user_id uuid, p_guest_day integer, p_guest_reserved boolean, p_generate boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  cached public.ai_suggestion_cache%rowtype;
  is_guest boolean;
  reservation jsonb;
  token uuid;
begin
  if p_context_id is null or length(p_context_id) not between 1 and 180 or p_context_id !~ '^[a-zA-Z0-9:/_.-]+$'
    or p_model is null or p_model !~ '^gemini-[a-zA-Z0-9.-]+$'
    or p_prompt_version is null or length(p_prompt_version) not between 1 and 80
    or p_content_hash is null or p_content_hash !~ '^[a-f0-9]{64}$'
    or p_guest_reserved is null or p_generate is null then
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
  if not p_generate then
    return jsonb_build_object('allowed', true, 'cached', false);
  end if;
  -- A hit is free. A denied guest miss must not clear or create shared cache rows.
  if is_guest is true and not p_guest_reserved then
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
$function$;
revoke all on function public.prepare_ai_suggestions(text,text,text,text,uuid,integer,boolean,boolean) from public, anon, authenticated;
grant execute on function public.prepare_ai_suggestions(text,text,text,text,uuid,integer,boolean,boolean) to service_role;

create function public.read_ai_chat_context(p_conversation_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  if exists (select 1 from public.ai_deleted_conversations where id = p_conversation_id and user_id = p_user_id) then
    raise exception 'AI conversation deleted' using errcode = 'P0002';
  end if;
  select jsonb_build_object('context', c.context, 'summary', c.summary,
    'through_seq', c.summary_through_seq, 'last_seq', c.last_turn_seq,
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.turn_seq) from (
      select turn_seq, question, answer from public.ai_chat_turns
      where conversation_id = c.id and turn_seq > c.summary_through_seq order by turn_seq limit 65
    ) t), '[]'::jsonb)) into result
    from public.ai_conversations c where c.id = p_conversation_id and c.user_id = p_user_id;
  if result is null and exists (select 1 from public.ai_conversations where id = p_conversation_id) then
    raise exception 'Not your AI conversation' using errcode = '42501';
  end if;
  return result;
end;
$function$;
revoke all on function public.read_ai_chat_context(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_ai_chat_context(uuid,uuid) to service_role;

create function public.record_ai_model_cooldown(p_model text, p_retry_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_retry_at is null or not isfinite(p_retry_at) or p_retry_at > now() + interval '8 days' then
    raise exception 'Invalid model cooldown' using errcode = '22023';
  end if;
  perform public.record_ai_model_outcome(p_model, clock_timestamp(), 'http_429');
end;
$function$;
revoke all on function public.record_ai_model_cooldown(text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.record_ai_model_cooldown(text,timestamp with time zone) to service_role;

create function public.record_ai_model_outcome(p_model text, p_attempt_started_at timestamp with time zone, p_error text)
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
$function$;
revoke all on function public.record_ai_model_outcome(text,timestamp with time zone,text) from public, anon, authenticated;
grant execute on function public.record_ai_model_outcome(text,timestamp with time zone,text) to service_role;

create function public.reserve_ai_guest_request(p_user_id uuid, p_user_day integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
$function$;
revoke all on function public.reserve_ai_guest_request(uuid,integer) from public, anon, authenticated;
grant execute on function public.reserve_ai_guest_request(uuid,integer) to service_role;

create function public.save_ai_chat_turn(p_conversation_id uuid, p_turn_id uuid, p_context jsonb, p_question text, p_answer text, p_created_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  owner_id uuid := auth.uid();
  conversation public.ai_conversations%rowtype;
  previous public.ai_chat_turns%rowtype;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from auth.users where id = owner_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  if p_conversation_id is null or p_turn_id is null or p_created_at is null
    or p_created_at > now() + interval '1 day' or p_created_at < timestamptz '2020-01-01'
    or p_question is null or length(btrim(p_question)) not between 1 and 2000
    or p_answer is null or length(btrim(p_answer)) not between 1 and 14000
    or p_context is null or jsonb_typeof(p_context) is distinct from 'object' or octet_length(p_context::text) > 65536
    or jsonb_typeof(p_context->'id') is distinct from 'string'
    or length(p_context->>'id') not between 1 and 180 or p_context->>'id' !~ '^[a-zA-Z0-9:/_.-]+$'
    or p_context->>'kind' is null or p_context->>'kind' not in ('concept','question','general')
    or jsonb_typeof(p_context->'title') is distinct from 'string' or length(p_context->>'title') not between 1 and 180
    or jsonb_typeof(p_context->'text') is distinct from 'string' or length(p_context->>'text') > 12000
    or jsonb_typeof(p_context->'hasImages') is distinct from 'boolean' then
    raise exception 'Invalid AI conversation' using errcode = '22023';
  end if;
  insert into public.ai_conversations (id, user_id, title, context)
    values (p_conversation_id, owner_id, left(regexp_replace(btrim(p_question), '\s+', ' ', 'g'), 100), p_context)
    on conflict (id) do nothing;
  select * into conversation from public.ai_conversations where id = p_conversation_id for update;
  if conversation.user_id <> owner_id then
    raise exception 'Not your AI conversation' using errcode = '42501';
  end if;
  if conversation.context is distinct from p_context then
    raise exception 'Conversation context changed' using errcode = '22023';
  end if;
  select * into previous from public.ai_chat_turns where id = p_turn_id;
  if found then
    if previous.conversation_id <> p_conversation_id or previous.question <> p_question or previous.answer <> p_answer then
      raise exception 'Turn ID already used' using errcode = '22023';
    end if;
    return jsonb_build_object('conversationId', p_conversation_id);
  end if;
  -- Preserve the original server request time on a delayed save retry.
  insert into public.ai_chat_turns (id, conversation_id, question, answer, created_at)
    values (p_turn_id, p_conversation_id, p_question, p_answer, p_created_at);
  update public.ai_conversations set updated_at = clock_timestamp() where id = p_conversation_id;
  return jsonb_build_object('conversationId', p_conversation_id);
end;
$function$;
revoke all on function public.save_ai_chat_turn(uuid,uuid,jsonb,text,text,timestamp with time zone) from public, anon, authenticated;
grant execute on function public.save_ai_chat_turn(uuid,uuid,jsonb,text,text,timestamp with time zone) to authenticated;

create function public.save_study_progress(p_user_id uuid, p_bank_id text, p_expected_revision bigint, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  return public.save_study_progress_member(p_user_id, p_bank_id, p_expected_revision, p_state);
end;
$function$;
revoke all on function public.save_study_progress(uuid,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_study_progress(uuid,text,bigint,jsonb) to authenticated;

create function public.save_study_progress_member(p_user_id uuid, p_bank_id text, p_expected_revision bigint, p_state jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  owner_id uuid := auth.uid();
  result public.study_progress%rowtype;
  item record;
begin
  if owner_id is null or p_user_id is distinct from owner_id then
    raise exception 'Account changed or not authenticated' using errcode = '42501';
  end if;
  if p_bank_id is distinct from 'saa-c03-684-20260926-v1'
    or p_expected_revision is null or p_expected_revision < 0
    or p_expected_revision > 9007199254740990
    or p_state is null or octet_length(p_state::text) > 524288
    or jsonb_typeof(p_state) is distinct from 'object'
    or p_state->>'bank' is distinct from p_bank_id
    or p_state->>'version' is distinct from '1'
    or jsonb_typeof(p_state->'current') is distinct from 'number'
    or (p_state->>'current') !~ '^[0-9]+$'
    or (p_state->>'current')::numeric not between 1 and 684
    or jsonb_typeof(p_state->'updatedAt') is distinct from 'number'
    or (p_state->>'updatedAt')::numeric < 0
    or jsonb_typeof(p_state->'records') is distinct from 'object'
    or p_state->>'filter' is null
    or p_state->>'filter' not in ('all','unanswered','wrong','flagged','missing')
    or jsonb_typeof(p_state->'query') is distinct from 'string'
    or length(p_state->>'query') > 200 then
    raise exception 'Invalid progress' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(p_state->'records') loop
    if item.key !~ '^[1-9][0-9]{0,2}$' or item.key::integer > 684
      or jsonb_typeof(item.value) is distinct from 'object'
      or jsonb_typeof(item.value->'selected') is distinct from 'array'
      or jsonb_typeof(item.value->'checked') is distinct from 'boolean'
      or jsonb_typeof(item.value->'flagged') is distinct from 'boolean'
      or jsonb_typeof(item.value->'updatedAt') is distinct from 'number'
      or (item.value->>'updatedAt')::numeric < 0 then
      raise exception 'Invalid question record' using errcode = '22023';
    end if;
    if jsonb_array_length(item.value->'selected') > 6
      or exists (select 1 from jsonb_array_elements(item.value->'selected') as choice(value)
        where jsonb_typeof(choice.value) is distinct from 'string'
        or choice.value #>> '{}' !~ '^[A-F]$')
      or (select count(*) from jsonb_array_elements(item.value->'selected'))
        <> (select count(distinct value) from jsonb_array_elements(item.value->'selected')) then
      raise exception 'Invalid answer selection' using errcode = '22023';
    end if;
  end loop;

  if p_expected_revision = 0 then
    insert into public.study_progress (user_id, bank_id, revision, state)
    values (owner_id, p_bank_id, 1, p_state)
    on conflict (user_id, bank_id) do nothing
    returning * into result;
  else
    update public.study_progress
    set state = p_state, revision = revision + 1, updated_at = now()
    where user_id = owner_id and bank_id = p_bank_id
      and revision = p_expected_revision
    returning * into result;
  end if;
  if found then
    return jsonb_build_object('revision', result.revision, 'state', result.state, 'conflict', false);
  end if;

  select * into result from public.study_progress
  where user_id = owner_id and bank_id = p_bank_id;
  return jsonb_build_object('revision', coalesce(result.revision, 0), 'state', result.state, 'conflict', true);
end;
$function$;
revoke all on function public.save_study_progress_member(uuid,text,bigint,jsonb) from public, anon, authenticated;

create function public.sequence_ai_chat_turn()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  update public.ai_conversations set last_turn_seq = last_turn_seq + 1
    where id = new.conversation_id returning last_turn_seq into new.turn_seq;
  return new;
end;
$function$;
revoke all on function public.sequence_ai_chat_turn() from public, anon, authenticated;

-- Server sequence assignment and protection against deleted-session resurrection.
CREATE TRIGGER ai_chat_turn_sequence BEFORE INSERT ON public.ai_chat_turns FOR EACH ROW EXECUTE FUNCTION public.sequence_ai_chat_turn();
CREATE TRIGGER guard_deleted_ai_conversation BEFORE INSERT ON public.ai_conversations FOR EACH ROW EXECUTE FUNCTION public.guard_deleted_ai_conversation();

commit;
