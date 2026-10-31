-- Apply after 202610310004_session_compaction.sql, then deploy study-assistant.
begin;

-- Keep identifiers only, never deleted titles, context, messages or summaries.
-- This prevents an old tab / in-flight answer from recreating a deleted session.
create table public.ai_deleted_conversations (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade
);
alter table public.ai_deleted_conversations enable row level security;
revoke all on public.ai_deleted_conversations from public, anon, authenticated;
grant all on public.ai_deleted_conversations to service_role;

create function public.guard_deleted_ai_conversation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- INSERT ... ON CONFLICT in save_ai_chat_turn always runs this trigger,
  -- including saves to existing sessions. Deletion takes the same lock first.
  perform pg_advisory_xact_lock(hashtextextended('ai-conversation:' || new.id::text, 0));
  if exists (select 1 from public.ai_deleted_conversations where id = new.id) then
    raise exception 'AI conversation deleted' using errcode = 'P0002';
  end if;
  return new;
end;
$$;
revoke all on function public.guard_deleted_ai_conversation() from public, anon, authenticated;
create trigger guard_deleted_ai_conversation before insert on public.ai_conversations
  for each row execute function public.guard_deleted_ai_conversation();

-- IDs and last activity times allow all/date selection across pagination without bodies.
-- Only these exact IDs will be deleted; newly created sessions stay untouched.
create function public.list_ai_conversation_selection() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare owner_id uuid := auth.uid();
begin
  if owner_id is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true'
    or not exists (select 1 from auth.users where id = owner_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'updated_at', updated_at) order by id), '[]'::jsonb)
    from public.ai_conversations where user_id = owner_id);
end;
$$;

create function public.delete_ai_conversations(p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.list_ai_conversation_selection() from public, anon, authenticated;
revoke all on function public.delete_ai_conversations(uuid[]) from public, anon, authenticated;
grant execute on function public.list_ai_conversation_selection() to authenticated;
grant execute on function public.delete_ai_conversations(uuid[]) to authenticated;

-- Refuse stale chat requests before spending Gemini quota.
create or replace function public.read_ai_chat_context(p_conversation_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;
revoke all on function public.read_ai_chat_context(uuid,uuid) from public, anon, authenticated;
grant execute on function public.read_ai_chat_context(uuid,uuid) to service_role;
commit;
