create function public.rename_ai_conversation(p_conversation_id uuid, p_title text, p_expected_title text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  owner_id uuid := auth.uid();
  previous_title text;
  new_title text;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from auth.users where id = owner_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  if p_conversation_id is null or p_title is null or length(btrim(p_title)) not between 1 and 100
    or p_title ~ '[[:cntrl:]]' or p_expected_title is null or length(p_expected_title) not between 1 and 100 then
    raise exception 'Invalid conversation title' using errcode = '22023';
  end if;
  select title into previous_title from public.ai_conversations
    where id = p_conversation_id and user_id = owner_id for update;
  if not found then
    raise exception 'AI conversation unavailable' using errcode = 'P0002';
  end if;
  if previous_title is distinct from p_expected_title then
    raise exception 'Conversation title changed' using errcode = '40001';
  end if;
  new_title := regexp_replace(btrim(p_title), '\s+', ' ', 'g');
  -- Renaming does not change the last chat time or which item session is resumed.
  update public.ai_conversations set title = new_title where id = p_conversation_id;
  return jsonb_build_object('id', p_conversation_id, 'title', new_title);
end;
$function$;
revoke all on function public.rename_ai_conversation(uuid,text,text) from public, anon, authenticated;
grant execute on function public.rename_ai_conversation(uuid,text,text) to authenticated;

create function public.read_ai_conversation_title_context(p_conversation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  owner_id uuid := auth.uid();
  conversation public.ai_conversations%rowtype;
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from auth.users where id = owner_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  select * into conversation from public.ai_conversations
    where id = p_conversation_id and user_id = owner_id;
  if not found then
    raise exception 'AI conversation unavailable' using errcode = 'P0002';
  end if;
  -- Bound model input regardless of the length of the saved conversation.
  return jsonb_build_object('title', conversation.title,
    'topic', conversation.context->>'title', 'kind', conversation.context->>'kind',
    'first_question', (select left(question, 600) from public.ai_chat_turns
      where conversation_id = p_conversation_id order by turn_seq limit 1),
    'recent_turns', coalesce((select jsonb_agg(jsonb_build_object(
      'question', left(t.question, 400), 'answer', left(t.answer, 700)) order by t.turn_seq)
      from (select question, answer, turn_seq from public.ai_chat_turns
        where conversation_id = p_conversation_id order by turn_seq desc limit 6) t), '[]'::jsonb));
end;
$function$;
revoke all on function public.read_ai_conversation_title_context(uuid) from public, anon, authenticated;
grant execute on function public.read_ai_conversation_title_context(uuid) to authenticated;
