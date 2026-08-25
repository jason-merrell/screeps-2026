begin;

drop function if exists public.claim_next_command(text, text[], integer);

create function public.claim_next_command(
  p_worker_id text,
  p_supported_types text[] default array['snapshot']::text[],
  p_lease_seconds integer default 600
)
returns setof public.commands
language plpgsql
security definer
set search_path = public
as $$
declare
  v_command public.commands;
begin
  if coalesce(trim(p_worker_id), '') = '' then
    raise exception 'worker id is required';
  end if;
  if p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'lease seconds out of range';
  end if;

  select * into v_command
  from public.commands
  where command_type = any(p_supported_types)
    and (
      status = 'pending'
      or (
        status = 'claimed'
        and lease_expires_at is not null
        and lease_expires_at < now()
      )
    )
  order by requested_at asc, id asc
  for update skip locked
  limit 1;

  if v_command.id is null then
    return;
  end if;

  update public.commands
  set status = 'claimed',
      claimed_at = now(),
      claimed_by = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds)
  where id = v_command.id
  returning * into v_command;

  insert into public.command_events (command_id, event_type, detail)
  values (
    v_command.id,
    'claimed',
    jsonb_build_object(
      'workerId', p_worker_id,
      'leaseExpiresAt', v_command.lease_expires_at
    )
  );

  return next v_command;
  return;
end;
$$;

revoke all on function public.claim_next_command(text, text[], integer) from public, anon, authenticated;
grant execute on function public.claim_next_command(text, text[], integer) to service_role;

commit;
