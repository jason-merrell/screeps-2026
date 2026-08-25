begin;

create policy "operators can read own commands"
  on public.commands for select
  to authenticated
  using (
    requested_by = auth.uid()
    and exists (
      select 1
      from public.command_operators operator
      where operator.user_id = auth.uid()
    )
  );

create policy "operators can read own command events"
  on public.command_events for select
  to authenticated
  using (
    exists (
      select 1
      from public.commands command
      join public.command_operators operator
        on operator.user_id = auth.uid()
      where command.id = command_events.command_id
        and command.requested_by = auth.uid()
    )
  );

grant select on public.commands to authenticated;
grant select on public.command_events to authenticated;

commit;
