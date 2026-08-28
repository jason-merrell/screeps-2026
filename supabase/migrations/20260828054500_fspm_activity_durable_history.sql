create table if not exists public.fspm_activity_history (
  colony_id uuid not null references public.colonies(id) on delete cascade,
  activity_id text not null,
  task_id text,
  assignee text,
  status text not null,
  current_procedure_id text,
  current_target_key text,
  current_disposition text,
  created_at_tick bigint,
  updated_at_tick bigint,
  completed_at_tick bigint,
  kpi_score text,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  first_game_tick bigint,
  last_game_tick bigint,
  latest_snapshot_id bigint references public.observability_snapshots(id) on delete set null,
  payload jsonb not null,
  primary key (colony_id, activity_id)
);

create index if not exists fspm_activity_history_status_idx
  on public.fspm_activity_history (colony_id, status, updated_at_tick desc);

create index if not exists fspm_activity_history_task_idx
  on public.fspm_activity_history (colony_id, task_id, updated_at_tick desc);

create table if not exists public.fspm_activity_event_history (
  colony_id uuid not null references public.colonies(id) on delete cascade,
  event_id text not null,
  event_sequence bigint,
  event_tick bigint,
  event_type text,
  activity_id text,
  first_observed_at timestamptz not null,
  last_observed_at timestamptz not null,
  first_game_tick bigint,
  last_game_tick bigint,
  latest_snapshot_id bigint references public.observability_snapshots(id) on delete set null,
  payload jsonb not null,
  primary key (colony_id, event_id)
);

create index if not exists fspm_activity_event_history_activity_idx
  on public.fspm_activity_event_history (colony_id, activity_id, event_sequence);

create index if not exists fspm_activity_event_history_type_idx
  on public.fspm_activity_event_history (colony_id, event_type, event_tick desc);

alter table public.fspm_activity_history enable row level security;
alter table public.fspm_activity_event_history enable row level security;

drop policy if exists "public can read durable FSPM activities" on public.fspm_activity_history;
create policy "public can read durable FSPM activities"
  on public.fspm_activity_history
  for select
  to anon, authenticated
  using (true);

drop policy if exists "public can read durable FSPM activity events" on public.fspm_activity_event_history;
create policy "public can read durable FSPM activity events"
  on public.fspm_activity_event_history
  for select
  to anon, authenticated
  using (true);

grant select on public.fspm_activity_history to anon, authenticated;
grant select on public.fspm_activity_event_history to anon, authenticated;

create or replace function public.persist_fspm_snapshot_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(new.payload #>> '{runtimeTrace,transport,activityRetentionVersion}', '0') <> '1' then
    return new;
  end if;

  insert into public.fspm_activity_history (
    colony_id,
    activity_id,
    task_id,
    assignee,
    status,
    current_procedure_id,
    current_target_key,
    current_disposition,
    created_at_tick,
    updated_at_tick,
    completed_at_tick,
    kpi_score,
    first_observed_at,
    last_observed_at,
    first_game_tick,
    last_game_tick,
    latest_snapshot_id,
    payload
  )
  select
    new.colony_id,
    activity ->> 'id',
    activity ->> 'taskId',
    activity ->> 'assignee',
    coalesce(activity ->> 'status', 'unknown'),
    activity ->> 'currentProcedureId',
    activity ->> 'currentTargetKey',
    activity ->> 'currentDisposition',
    nullif(activity ->> 'createdAt', '')::bigint,
    nullif(activity ->> 'updatedAt', '')::bigint,
    nullif(activity ->> 'completedAt', '')::bigint,
    activity ->> 'kpiScore',
    new.captured_at,
    new.captured_at,
    new.game_tick,
    new.game_tick,
    new.id,
    activity
  from jsonb_array_elements(
    coalesce(new.payload #> '{runtimeTrace,fspm,colonies}', '[]'::jsonb)
  ) colony
  cross join lateral jsonb_array_elements(
    coalesce(colony -> 'activities', '[]'::jsonb)
  ) activity
  where nullif(activity ->> 'id', '') is not null
  on conflict (colony_id, activity_id) do update set
    task_id = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.task_id
      else public.fspm_activity_history.task_id
    end,
    assignee = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.assignee
      else public.fspm_activity_history.assignee
    end,
    status = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.status
      else public.fspm_activity_history.status
    end,
    current_procedure_id = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.current_procedure_id
      else public.fspm_activity_history.current_procedure_id
    end,
    current_target_key = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.current_target_key
      else public.fspm_activity_history.current_target_key
    end,
    current_disposition = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.current_disposition
      else public.fspm_activity_history.current_disposition
    end,
    created_at_tick = coalesce(public.fspm_activity_history.created_at_tick, excluded.created_at_tick),
    updated_at_tick = greatest(
      coalesce(public.fspm_activity_history.updated_at_tick, -1),
      coalesce(excluded.updated_at_tick, -1)
    ),
    completed_at_tick = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then coalesce(excluded.completed_at_tick, public.fspm_activity_history.completed_at_tick)
      else public.fspm_activity_history.completed_at_tick
    end,
    kpi_score = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then coalesce(excluded.kpi_score, public.fspm_activity_history.kpi_score)
      else public.fspm_activity_history.kpi_score
    end,
    first_observed_at = least(public.fspm_activity_history.first_observed_at, excluded.first_observed_at),
    last_observed_at = greatest(public.fspm_activity_history.last_observed_at, excluded.last_observed_at),
    first_game_tick = least(public.fspm_activity_history.first_game_tick, excluded.first_game_tick),
    last_game_tick = greatest(public.fspm_activity_history.last_game_tick, excluded.last_game_tick),
    latest_snapshot_id = case
      when excluded.last_observed_at >= public.fspm_activity_history.last_observed_at
        then excluded.latest_snapshot_id
      else public.fspm_activity_history.latest_snapshot_id
    end,
    payload = case
      when excluded.updated_at_tick >= coalesce(public.fspm_activity_history.updated_at_tick, -1)
        then excluded.payload
      else public.fspm_activity_history.payload
    end;

  insert into public.fspm_activity_event_history (
    colony_id,
    event_id,
    event_sequence,
    event_tick,
    event_type,
    activity_id,
    first_observed_at,
    last_observed_at,
    first_game_tick,
    last_game_tick,
    latest_snapshot_id,
    payload
  )
  select
    new.colony_id,
    event ->> 'id',
    nullif(event ->> 'sequence', '')::bigint,
    nullif(event ->> 'tick', '')::bigint,
    event ->> 'type',
    event ->> 'activityId',
    new.captured_at,
    new.captured_at,
    new.game_tick,
    new.game_tick,
    new.id,
    event
  from jsonb_array_elements(
    coalesce(new.payload #> '{runtimeTrace,fspm,colonies}', '[]'::jsonb)
  ) colony
  cross join lateral jsonb_array_elements(
    coalesce(colony -> 'activityEvents', '[]'::jsonb)
  ) event
  where nullif(event ->> 'id', '') is not null
  on conflict (colony_id, event_id) do update set
    event_sequence = coalesce(excluded.event_sequence, public.fspm_activity_event_history.event_sequence),
    event_tick = coalesce(excluded.event_tick, public.fspm_activity_event_history.event_tick),
    event_type = coalesce(excluded.event_type, public.fspm_activity_event_history.event_type),
    activity_id = coalesce(excluded.activity_id, public.fspm_activity_event_history.activity_id),
    first_observed_at = least(public.fspm_activity_event_history.first_observed_at, excluded.first_observed_at),
    last_observed_at = greatest(public.fspm_activity_event_history.last_observed_at, excluded.last_observed_at),
    first_game_tick = least(public.fspm_activity_event_history.first_game_tick, excluded.first_game_tick),
    last_game_tick = greatest(public.fspm_activity_event_history.last_game_tick, excluded.last_game_tick),
    latest_snapshot_id = case
      when excluded.last_observed_at >= public.fspm_activity_event_history.last_observed_at
        then excluded.latest_snapshot_id
      else public.fspm_activity_event_history.latest_snapshot_id
    end,
    payload = excluded.payload;

  return new;
end;
$$;

drop trigger if exists observability_snapshot_fspm_history on public.observability_snapshots;
create trigger observability_snapshot_fspm_history
after insert or update of payload on public.observability_snapshots
for each row
execute function public.persist_fspm_snapshot_history();

comment on table public.fspm_activity_history is
  'Canonical latest row per FSPM Activity, durably upserted from the bounded Segment 99 polling window before in-game eviction.';

comment on table public.fspm_activity_event_history is
  'Canonical FSPM Activity lifecycle events observed by recurring Segment 99 polling.';
