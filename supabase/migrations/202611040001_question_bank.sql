-- Renumbered questions use a new bank ID; old progress is not imported.
-- The write RPC validates the active bank and its question range.
begin;

alter table public.study_progress drop constraint study_progress_bank_id_check;
alter table public.study_progress add constraint study_progress_bank_id_check
  check (bank_id ~ '^saa-c03-[1-9][0-9]*-[0-9]{8}-v[1-9][0-9]*$');

create or replace function public.save_study_progress_member(p_user_id uuid, p_bank_id text, p_expected_revision bigint, p_state jsonb)
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
  if p_bank_id is distinct from 'saa-c03-618-20261104-v2'
    or p_expected_revision is null or p_expected_revision < 0
    or p_expected_revision > 9007199254740990
    or p_state is null or octet_length(p_state::text) > 524288
    or jsonb_typeof(p_state) is distinct from 'object'
    or p_state->>'bank' is distinct from p_bank_id
    or p_state->>'version' is distinct from '1'
    or jsonb_typeof(p_state->'current') is distinct from 'number'
    or (p_state->>'current') !~ '^[0-9]+$'
    or (p_state->>'current')::numeric not between 1 and 618
    or jsonb_typeof(p_state->'updatedAt') is distinct from 'number'
    or (p_state->>'updatedAt')::numeric < 0
    or jsonb_typeof(p_state->'records') is distinct from 'object'
    or p_state->>'filter' is null
    or p_state->>'filter' not in ('all','unanswered','wrong','flagged')
    or jsonb_typeof(p_state->'query') is distinct from 'string'
    or length(p_state->>'query') > 200 then
    raise exception 'Invalid progress' using errcode = '22023';
  end if;
  for item in select key, value from jsonb_each(p_state->'records') loop
    if item.key !~ '^[1-9][0-9]{0,2}$' or item.key::integer > 618
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

commit;
