begin;

create table if not exists public.colonies (
  id uuid primary key default gen_random_uuid(),
  target text not null check (target in ('ptr', 'world', 'sim', 'headless')),
  shard text not null,
  room_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (target, shard, room_name)
);

create table if not exists public.observability_snapshots (
  id bigint generated always as identity primary key,
  schema text not null,
  schema_version integer not null check (schema_version > 0),
  colony_id uuid not null references public.colonies(id) on delete cascade,
  captured_at timestamptz not null,
  game_tick bigint,
  source_request_id text,
  payload jsonb not null,
  inserted_at timestamptz not null default now(),
  unique (source_request_id)
);

create index if not exists observability_snapshots_colony_captured_idx
  on public.observability_snapshots (colony_id, captured_at desc);

create table if not exists public.experiments (
  id uuid primary key default gen_random_uuid(),
  experiment_key text not null unique,
  name text not null,
  target text not null check (target in ('ptr', 'world', 'sim', 'headless')),
  shard text,
  room_name text,
  runtime_sha text,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  started_at timestamptz,
  completed_at timestamptz,
  result jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.commands (
  id uuid primary key default gen_random_uuid(),
  command_key text not null unique,
  command_type text not null,
  target text not null check (target in ('ptr', 'world', 'sim', 'headless')),
  shard text,
  room_name text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'executing', 'succeeded', 'failed', 'cancelled')),
  requested_by uuid,
  requested_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists commands_status_requested_idx
  on public.commands (status, requested_at);

create table if not exists public.command_events (
  id bigint generated always as identity primary key,
  command_id uuid not null references public.commands(id) on delete cascade,
  event_type text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index if not exists command_events_command_occurred_idx
  on public.command_events (command_id, occurred_at);

alter table public.colonies enable row level security;
alter table public.observability_snapshots enable row level security;
alter table public.experiments enable row level security;
alter table public.commands enable row level security;
alter table public.command_events enable row level security;

-- The current GitHub ledger is already public. Preserve that read posture only for
-- the explicitly sanitized colony read model while we migrate Screeps Lab.
create policy "public can read colonies"
  on public.colonies for select
  to anon, authenticated
  using (true);

create policy "public can read sanitized snapshots"
  on public.observability_snapshots for select
  to anon, authenticated
  using (true);

create policy "public can read completed experiments"
  on public.experiments for select
  to anon, authenticated
  using (status = 'succeeded');

-- Deliberately no client policies exist for commands or command_events.
-- Trusted server-side workers use a Supabase secret/service credential and are
-- the only actors permitted to create/claim/complete commands during this phase.

commit;
