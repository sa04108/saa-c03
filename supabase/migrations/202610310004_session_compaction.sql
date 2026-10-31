-- Apply after 202610310003_model_failure_backoff.sql, then deploy study-assistant.
-- Preserve every original turn. Summaries are private, derived session memory.
begin;
lock table public.ai_conversations, public.ai_chat_turns in access exclusive mode;

alter table public.ai_chat_turns add column turn_seq bigint;
with numbered as (
  select id, row_number() over (partition by conversation_id order by created_at, id) as seq
  from public.ai_chat_turns
)
update public.ai_chat_turns t set turn_seq = n.seq from numbered n where n.id = t.id;
alter table public.ai_chat_turns alter column turn_seq set not null;
create unique index ai_chat_turns_sequence on public.ai_chat_turns(conversation_id, turn_seq);

alter table public.ai_conversations
  add column last_turn_seq bigint not null default 0,
  add column summary jsonb,
  add column summary_through_seq bigint not null default 0,
  add column summary_revision integer not null default 0,
  add column summary_model text,
  add column summary_prompt_version text,
  add column summary_job_id uuid,
  add column summary_job_through_seq bigint,
  add column summary_lease_until timestamptz,
  add column summary_retry_after timestamptz not null default 'epoch',
  add constraint ai_summary_range check (summary_through_seq between 0 and last_turn_seq),
  add constraint ai_summary_size check (summary is null or
    (jsonb_typeof(summary) = 'object' and octet_length(summary::text) <= 24000));
update public.ai_conversations c set last_turn_seq = t.seq
  from (select conversation_id, max(turn_seq) as seq from public.ai_chat_turns group by conversation_id) t
  where c.id = t.conversation_id;

-- The existing save RPC already locks the parent row and remains compatible.
-- Late browser retries get a new server sequence, even with an old created_at.
create function public.sequence_ai_chat_turn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.ai_conversations set last_turn_seq = last_turn_seq + 1
    where id = new.conversation_id returning last_turn_seq into new.turn_seq;
  return new;
end;
$$;
revoke all on function public.sequence_ai_chat_turn() from public, anon, authenticated;
create trigger ai_chat_turn_sequence before insert on public.ai_chat_turns
  for each row execute function public.sequence_ai_chat_turn();

-- Only the Edge Function supplies p_user_id, after verifying the bearer token.
-- A single statement snapshot keeps the summary and raw tail consistent.
create function public.read_ai_chat_context(p_conversation_id uuid, p_user_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
  if not exists (select 1 from auth.users where id = p_user_id and is_anonymous is not true) then
    raise exception 'A linked account is required' using errcode = '42501';
  end if;
  select jsonb_build_object('context', c.context, 'summary', c.summary,
    'through_seq', c.summary_through_seq, 'last_seq', c.last_turn_seq,
    'turns', coalesce((select jsonb_agg(to_jsonb(t) order by t.turn_seq) from (
      select turn_seq, question, answer from public.ai_chat_turns
      where conversation_id = c.id and turn_seq > c.summary_through_seq
      order by turn_seq limit 65
    ) t), '[]'::jsonb)) into result
    from public.ai_conversations c where c.id = p_conversation_id and c.user_id = p_user_id;
  if result is null and exists (select 1 from public.ai_conversations where id = p_conversation_id) then
    raise exception 'Not your AI conversation' using errcode = '42501';
  end if;
  return result;
end;
$$;

create function public.claim_ai_compaction(p_conversation_id uuid, p_user_id uuid, p_force boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
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
$$;

-- A null summary releases a failed job with a short retry delay. Expired jobs
-- can be reclaimed; their old result can never replace the new job's result.
create function public.finish_ai_compaction(
  p_conversation_id uuid, p_user_id uuid, p_job_id uuid, p_revision integer,
  p_through_seq bigint, p_summary jsonb, p_model text, p_prompt_version text
) returns boolean
language plpgsql security definer set search_path = '' as $$
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
$$;

revoke all on function public.read_ai_chat_context(uuid,uuid) from public, anon, authenticated;
revoke all on function public.claim_ai_compaction(uuid,uuid,boolean) from public, anon, authenticated;
revoke all on function public.finish_ai_compaction(uuid,uuid,uuid,integer,bigint,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.read_ai_chat_context(uuid,uuid) to service_role;
grant execute on function public.claim_ai_compaction(uuid,uuid,boolean) to service_role;
grant execute on function public.finish_ai_compaction(uuid,uuid,uuid,integer,bigint,jsonb,text,text) to service_role;
commit;
