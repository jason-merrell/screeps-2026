create or replace view public.fspm_activity_observations
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
    activity
  from observation_source o
  cross join lateral jsonb_array_elements(
    coalesce(o.runtime_trace #> '{fspm,colonies}', '[]'::jsonb)
  ) colony
  cross join lateral jsonb_array_elements(
    coalesce(colony -> 'activities', '[]'::jsonb)
  ) activity
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
  activity ->> 'id' as activity_id,
  activity ->> 'taskId' as task_id,
  activity ->> 'assignee' as assignee,
  activity ->> 'status' as status,
  activity ->> 'currentProcedureId' as current_procedure_id,
  nullif(activity ->> 'createdAt', '')::bigint as created_at_tick,
  nullif(activity ->> 'startedAt', '')::bigint as started_at_tick,
  nullif(activity ->> 'updatedAt', '')::bigint as updated_at_tick,
  nullif(activity ->> 'completedAt', '')::bigint as completed_at_tick,
  activity ->> 'kpiScore' as kpi_score,
  nullif(activity ->> 'continuityRatio', '')::numeric as continuity_ratio,
  activity ->> 'holdReason' as hold_reason,
  nullif(activity #>> '{metrics,inProgressTicks}', '')::bigint as in_progress_ticks,
  nullif(activity #>> '{metrics,onHoldTicks}', '')::bigint as on_hold_ticks,
  nullif(activity #>> '{metrics,productiveTicks}', '')::bigint as productive_ticks,
  nullif(activity #>> '{metrics,travelTicks}', '')::bigint as travel_ticks,
  nullif(activity #>> '{metrics,idleTicks}', '')::bigint as idle_ticks,
  nullif(activity #>> '{metrics,holdCount}', '')::bigint as hold_count,
  nullif(activity #>> '{metrics,resumeCount}', '')::bigint as resume_count,
  nullif(activity #>> '{metrics,taskPreemptions}', '')::bigint as task_preemptions,
  nullif(activity #>> '{metrics,procedureTransitions}', '')::bigint as procedure_transitions,
  activity ->> 'currentTargetKey' as current_target_key,
  activity ->> 'currentDisposition' as current_disposition,
  activity ->> 'kpiEvidence' as kpi_evidence,
  nullif(activity ->> 'workConversionRatio', '')::numeric as work_conversion_ratio,
  nullif(activity ->> 'timeToFirstProductiveWork', '')::bigint as time_to_first_productive_work,
  nullif(activity ->> 'timeToCompletion', '')::bigint as time_to_completion,
  nullif(activity #>> '{metrics,waitTicks}', '')::bigint as wait_ticks,
  nullif(activity #>> '{metrics,assignmentGapTicks}', '')::bigint as assignment_gap_ticks,
  nullif(activity #>> '{metrics,arbitrationLostTicks}', '')::bigint as arbitration_lost_ticks,
  nullif(activity #>> '{metrics,blockedTicks}', '')::bigint as blocked_ticks,
  nullif(activity #>> '{metrics,targetRetargets}', '')::bigint as target_retargets,
  nullif(activity #>> '{metrics,currentTravelStreak}', '')::bigint as current_travel_streak,
  nullif(activity #>> '{metrics,maxTravelStreak}', '')::bigint as max_travel_streak,
  nullif(activity #>> '{metrics,firstProductiveAt}', '')::bigint as first_productive_at_tick,
  activity -> 'outcome' as outcome,
  activity -> 'procedureHistory' as procedure_history
from expanded;

comment on view public.fspm_activity_observations is
  'Relational query surface over governed FSPM Activity observations, including closeout, retarget, conversion, latency, and disposition evidence.';

create or replace view public.fspm_assignment_observations
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
    assignment
  from observation_source o
  cross join lateral jsonb_array_elements(
    coalesce(o.runtime_trace #> '{fspm,assignments}', '[]'::jsonb)
  ) assignment
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
  assignment ->> 'assignee' as assignee,
  assignment ->> 'state' as assignment_state,
  assignment ->> 'activityId' as activity_id,
  assignment ->> 'taskId' as task_id,
  assignment ->> 'procedureId' as procedure_id,
  assignment ->> 'targetKey' as target_key,
  assignment ->> 'reason' as reason
from expanded;

comment on view public.fspm_assignment_observations is
  'Per-observed-tick creep assignment disposition: execution, travel, intentional wait, hold, planner gap, arbitration loss, or blocking.';

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
  event ->> 'kpiScore' as kpi_score
from canonical;

comment on view public.fspm_activity_events is
  'Canonical bounded FSPM Activity lifecycle event journal deduplicated across overlapping telemetry observations.';
