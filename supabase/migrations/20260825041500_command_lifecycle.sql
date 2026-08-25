begin;

create or replace function public.register_command(
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
  v_command public.commands;
begin
  insert into public.commands (
    command_key,
    command_type,
    target,
    shard,
    room_name,
    payload,
    status
  ) values (
    p_command_key,
    p_command_type,
    p_target,
    p_shard,
    p_room_name,
    coalesce(p_payload, '{}'::jsonb),
    'claimed'
  )
  on conflict (command_key) do nothing
  returning * into v_command;

  if v_command.id is null then
    select * into v_command
    from public.commands
    where command_key = p_command_key;
  else
    insert into public.command_events (command_id, event_type, detail)
    values (v_command.id, 'claimed', jsonb_build_object('source', 'github-compatibility-ingress'));
  end if;

  return v_command;
end;
$$;

create or replace function public.transition_command(
  p_command_key text,
  p_status text,
  p_event_type text,
  p_detail jsonb default '{}'::jsonb
)
returns public.commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command public.commands;
begin
  if p_status not in ('claimed', 'executing', 'succeeded', 'failed', 'cancelled') then
    raise exception 'invalid command status %', p_status;
  end if;

  update public.commands
  set status = p_status,
      completed_at = case when p_status in ('succeeded', 'failed', 'cancelled') then coalesce(completed_at, now()) else completed_at end
  where command_key = p_command_key
    and not (status in ('succeeded', 'failed', 'cancelled') and status <> p_status)
  returning * into v_command;

  if v_command.id is null then
    select * into v_command
    from public.commands
    where command_key = p_command_key;
  end if;

  if v_command.id is null then
    raise exception 'command not found: %', p_command_key;
  end if;

  if not exists (
    select 1 from public.command_events
    where command_id = v_command.id
      and event_type = p_event_type
      and detail = coalesce(p_detail, '{}'::jsonb)
  ) then
    insert into public.command_events (command_id, event_type, detail)
    values (v_command.id, p_event_type, coalesce(p_detail, '{}'::jsonb));
  end if;

  return v_command;
end;
$$;

revoke all on function public.register_command(text, text, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.transition_command(text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.register_command(text, text, text, text, text, jsonb) to service_role;
grant execute on function public.transition_command(text, text, text, jsonb) to service_role;

commit;
