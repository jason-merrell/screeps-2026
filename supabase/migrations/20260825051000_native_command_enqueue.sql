begin;

create or replace function public.enqueue_command(
  p_command_key text,
  p_command_type text,
  p_target text,
  p_shard text,
  p_room_name text,
  p_payload jsonb default '{}'::jsonb
)
returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_command public.commands;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  if not exists (
    select 1
    from public.command_operators
    where user_id = v_user_id
  ) then
    raise exception 'operator authorization required';
  end if;

  if p_command_key is null or length(trim(p_command_key)) < 8 then
    raise exception 'invalid command key';
  end if;

  if p_command_type <> 'snapshot' then
    raise exception 'unsupported command type %', p_command_type;
  end if;

  if p_target not in ('ptr', 'world', 'sim', 'headless') then
    raise exception 'invalid target %', p_target;
  end if;

  if p_shard is null or length(trim(p_shard)) = 0 then
    raise exception 'shard is required';
  end if;

  if p_room_name is null or p_room_name !~ '^[WE][0-9]+[NS][0-9]+$' then
    raise exception 'invalid room name %', p_room_name;
  end if;

  insert into public.commands (
    command_key,
    command_type,
    target,
    shard,
    room_name,
    payload,
    status,
    requested_by
  ) values (
    trim(p_command_key),
    p_command_type,
    p_target,
    trim(p_shard),
    p_room_name,
    v_payload,
    'pending',
    v_user_id
  )
  on conflict (command_key) do nothing
  returning * into v_command;

  if v_command.id is null then
    select * into v_command
    from public.commands
    where command_key = trim(p_command_key);

    if v_command.id is null then
      raise exception 'command key collision without command row';
    end if;

    if v_command.command_type is distinct from p_command_type
      or v_command.target is distinct from p_target
      or v_command.shard is distinct from trim(p_shard)
      or v_command.room_name is distinct from p_room_name
      or v_command.payload is distinct from v_payload
      or v_command.requested_by is distinct from v_user_id then
      raise exception 'command key already exists with different command data';
    end if;
  else
    insert into public.command_events (command_id, event_type, detail)
    values (
      v_command.id,
      'queued',
      jsonb_build_object('source', 'screeps-lab', 'requested_by', v_user_id)
    );
  end if;

  return v_command;
end;
$$;

revoke all on function public.enqueue_command(text, text, text, text, text, jsonb) from public, anon;
grant execute on function public.enqueue_command(text, text, text, text, text, jsonb) to authenticated;

commit;
