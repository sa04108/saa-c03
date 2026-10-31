-- Upgrade from cce61d536c2947f5ad7e8e5d469b17be291022d3.
-- All changes after that applied baseline are combined in this transaction.
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
  p_guest_day integer,
  p_guest_reserved boolean,
  p_generate boolean
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
$$;
revoke all on function public.prepare_ai_suggestions(text,text,text,text,uuid,integer,boolean,boolean) from public, anon, authenticated;
grant execute on function public.prepare_ai_suggestions(text,text,text,text,uuid,integer,boolean,boolean) to service_role;

-- This is provider feedback, not an additional site RPM/RPD/TPM cap.
-- All Edge Function instances share Google's retry time for each model.
create table public.ai_model_cooldowns (
  model text primary key check (model ~ '^gemini-[a-zA-Z0-9.-]+$'),
  retry_at timestamptz not null
);
alter table public.ai_model_cooldowns enable row level security;
revoke all on public.ai_model_cooldowns from public, anon, authenticated;
grant all on public.ai_model_cooldowns to service_role;

create function public.record_ai_model_cooldown(p_model text, p_retry_at timestamptz) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_model is null or p_model !~ '^gemini-[a-zA-Z0-9.-]+$'
    or p_retry_at is null or not isfinite(p_retry_at) or p_retry_at > now() + interval '8 days' then
    raise exception 'Invalid model cooldown' using errcode = '22023';
  end if;
  insert into public.ai_model_cooldowns(model, retry_at) values (p_model, p_retry_at)
    on conflict (model) do update set retry_at = greatest(public.ai_model_cooldowns.retry_at, excluded.retry_at);
end;
$$;
revoke all on function public.record_ai_model_cooldown(text,timestamptz) from public, anon, authenticated;
grant execute on function public.record_ai_model_cooldown(text,timestamptz) to service_role;

create table public.ai_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (length(title) between 1 and 100),
  context jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index ai_conversations_owner_updated on public.ai_conversations (user_id, updated_at desc, id desc);

-- Store each completed question/answer together, without repeating its context.
create table public.ai_chat_turns (
  id uuid primary key,
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  question text not null check (length(btrim(question)) between 1 and 2000),
  answer text not null check (length(btrim(answer)) between 1 and 14000),
  created_at timestamptz not null
);
create index ai_chat_turns_conversation_created on public.ai_chat_turns (conversation_id, created_at desc, id desc);

alter table public.ai_conversations enable row level security;
alter table public.ai_chat_turns enable row level security;
revoke all on public.ai_conversations, public.ai_chat_turns from public, anon, authenticated;
grant select on public.ai_conversations, public.ai_chat_turns to authenticated;

create policy "Read own AI conversations" on public.ai_conversations for select to authenticated
  using (user_id = (select auth.uid()) and coalesce((select auth.jwt())->>'is_anonymous', 'false') <> 'true');
create policy "Read own AI chat turns" on public.ai_chat_turns for select to authenticated
  using (coalesce((select auth.jwt())->>'is_anonymous', 'false') <> 'true'
    and exists (select 1 from public.ai_conversations c where c.id = conversation_id and c.user_id = (select auth.uid())));

-- The Edge Function calls with the verified user's JWT; the browser may retry
-- a failed save with the same turn ID without generating another Gemini answer.
create function public.save_ai_chat_turn(
  p_conversation_id uuid,
  p_turn_id uuid,
  p_context jsonb,
  p_question text,
  p_answer text,
  p_created_at timestamptz
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
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
$$;
revoke all on function public.save_ai_chat_turn(uuid,uuid,jsonb,text,text,timestamptz) from public, anon, authenticated;
grant execute on function public.save_ai_chat_turn(uuid,uuid,jsonb,text,text,timestamptz) to authenticated;

commit;
