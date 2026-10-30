-- Run in the Supabase SQL Editor. Each authenticated user can read only their
-- own progress. Writes go through a revision-checked RPC, never direct upserts.
begin;

create table public.study_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  bank_id text not null check (bank_id = 'saa-c03-684-20260926-v1'),
  revision bigint not null check (revision > 0),
  state jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, bank_id)
);

alter table public.study_progress enable row level security;
revoke all on table public.study_progress from public, anon, authenticated;
grant select on table public.study_progress to authenticated;

create policy "Read own study progress"
on public.study_progress for select to authenticated
using ((select auth.uid()) = user_id);

create function public.save_study_progress(
  p_user_id uuid,
  p_bank_id text,
  p_expected_revision bigint,
  p_state jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
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
$$;

revoke all on function public.save_study_progress(uuid,text,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.save_study_progress(uuid,text,bigint,jsonb) to authenticated;

commit;
