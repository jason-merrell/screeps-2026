begin;

create table if not exists public.command_operators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  label text,
  created_at timestamptz not null default now()
);

alter table public.command_operators enable row level security;

create policy "operators can read own membership"
  on public.command_operators
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke insert, update, delete on public.command_operators from anon, authenticated;
grant select on public.command_operators to authenticated;

comment on table public.command_operators is
  'Explicit allowlist for authenticated Screeps Lab users permitted to submit commands. No client write policies exist.';

commit;
