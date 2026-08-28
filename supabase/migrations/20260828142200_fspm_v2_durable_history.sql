alter table public.fspm_activity_event_history
  add column if not exists previous_assignee text;

update public.fspm_activity_event_history
set previous_assignee = payload ->> 'previousAssignee'
where previous_assignee is null
  and nullif(payload ->> 'previousAssignee', '') is not null;

create or replace view public.fspm_activity_events
with (security_invoker = true)
as
with observation_source as (
  select
    'snapshot'::text as source_type,
    os.id::text as source_id,
    os.colony_id,
    null::uuid as experiment_id,
    null::uuid as collection_run_id,
    os.captured_at,
    os.game_tick,
    null::text as runtime_sha,
    os.payload -> 'runtimeTrace' as runtime_trace
  from public.observability_snapshots os

  union all

  select
    'telemetry_sample'::text as source_type,
    ts.id::text as source_id,
    ts.colony_id,
    ts.experiment_id,
    ts.collection_run_id,
    ts.captured_at,
    ts.game_tick,
    ts.runtime_sha,
    ts.payload -> 'runtimeTrace' as runtime_trace
  from public.telemetry_samples ts
), expanded as (
  select
    o.*,
    colony ->> 'roomName' as room_name,
    event
  from observation_source o
  cross join lateral jsonb_array_elements(
    coalesce(o.runtime_trace #> '{fspm,colonies}', '[]'::jsonb)
  ) colony
  cross join lateral jsonb_array_elements(
    coalesce(colony -> 'activityEvents', '[]'::jsonb)
  ) event
), canonical as (
  select distinct on (colony_id, event ->> 'id')
    source_type,
    source_id,
    colony_id,
    experiment_id,
    collection_run_id,
    captured_at,
    game_tick,
    runtime_sha,
    room_name,
    event
  from expanded
  where event ->> 'id' is not null
  order by colony_id, event ->> 'id', captured_at asc
)
select
  source_type,
  source_id,
  colony_id,
  experiment_id,
  collection_run_id,
  captured_at,
  game_tick,
  runtime_sha,
  room_name,
  event ->> 'id' as event_id,
  nullif(event ->> 'sequence', '')::bigint as event_sequence,
  nullif(event ->> 'tick', '')::bigint as event_tick,
  event ->> 'type' as event_type,
  event ->> 'activityId' as activity_id,
  event ->> 'taskId' as task_id,
  event ->> 'actor' as actor,
  event ->> 'procedureId' as procedure_id,
  event ->> 'targetKey' as target_key,
  event ->> 'previousTargetKey' as previous_target_key,
  event ->> 'reason' as reason,
  event ->> 'kpiScore' as kpi_score,
  event ->> 'previousAssignee' as previous_assignee
from canonical;

comment on view public.fspm_activity_events is
  'Canonical bounded FSPM Activity lifecycle event journal deduplicated across overlapping telemetry observations, including structured assignee reassignment evidence.';

create or replace function public.persist_fspm_snapshot_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  retention_version text;
begin
  retention_version := coalesce(
    new.payload #>> '{runtimeTrace,transport,activityRetentionVersion}',
    '0'
  );

  if retention_version not in ('1', '2') then
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
    previous_assignee,
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
    event ->> 'previousAssignee',
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
    previous_assignee = coalesce(excluded.previous_assignee, public.fspm_activity_event_history.previous_assignee),
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

comment on function public.persist_fspm_snapshot_history() is
  'Persists supported bounded FSPM Activity transport schemas (v1-v2) into durable Activity and lifecycle-event history.';
