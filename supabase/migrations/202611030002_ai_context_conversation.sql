-- A linked account resumes the latest conversation for the same study item.
-- Keep older duplicate conversations intact; free questions remain independent.
create index ai_conversations_context_lookup
  on public.ai_conversations (user_id, (context->>'id'), updated_at desc, id desc)
  where context->>'kind' in ('concept', 'question');

create function public.resolve_ai_context_conversation(p_context jsonb, p_question text default null)
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
  if p_context is null or jsonb_typeof(p_context) is distinct from 'object' or octet_length(p_context::text) > 65536
    or jsonb_typeof(p_context->'id') is distinct from 'string'
    or length(p_context->>'id') not between 1 and 180 or p_context->>'id' !~ '^[a-zA-Z0-9:/_.-]+$'
    or p_context->>'kind' is null or p_context->>'kind' not in ('concept','question')
    or jsonb_typeof(p_context->'title') is distinct from 'string' or length(p_context->>'title') not between 1 and 180
    or jsonb_typeof(p_context->'text') is distinct from 'string' or length(p_context->>'text') > 12000
    or jsonb_typeof(p_context->'hasImages') is distinct from 'boolean'
    or (p_question is not null and length(btrim(p_question)) not between 1 and 2000) then
    raise exception 'Invalid AI conversation' using errcode = '22023';
  end if;

  -- Serialize lookup + creation across devices without merging existing history.
  perform pg_advisory_xact_lock(hashtextextended('ai-context:' || owner_id::text || ':' || (p_context->>'id'), 0));
  select * into conversation from public.ai_conversations
    where user_id = owner_id and context->>'id' = p_context->>'id'
      and context->>'kind' in ('concept', 'question')
    order by updated_at desc, id desc limit 1;
  if not found then
    -- Opening a card does not create an empty history entry; sending a question does.
    if p_question is null then return null; end if;
    insert into public.ai_conversations (id, user_id, title, context)
      values (gen_random_uuid(), owner_id, left(regexp_replace(btrim(p_question), '\s+', ' ', 'g'), 100), p_context)
      returning * into conversation;
  end if;
  return jsonb_build_object('id', conversation.id, 'context', conversation.context);
end;
$function$;
revoke all on function public.resolve_ai_context_conversation(jsonb,text) from public, anon, authenticated;
grant execute on function public.resolve_ai_context_conversation(jsonb,text) to authenticated;
