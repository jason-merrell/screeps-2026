alter table public.collection_profiles enable row level security;
alter table public.collection_runs enable row level security;
alter table public.telemetry_samples enable row level security;

drop policy if exists "public can read sanitized telemetry samples" on public.telemetry_samples;
create policy "public can read sanitized telemetry samples"
on public.telemetry_samples
for select
to anon, authenticated
using (true);

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
  nullif(activity #>> '{metrics,procedureTransitions}', '')::bigint as procedure_transitions
from expanded;

comment on view public.fspm_activity_observations is 'Relational query surface over governed FSPM Activity observations from recurring snapshots and longitudinal telemetry samples.';
