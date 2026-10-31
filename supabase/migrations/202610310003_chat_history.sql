begin;

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
