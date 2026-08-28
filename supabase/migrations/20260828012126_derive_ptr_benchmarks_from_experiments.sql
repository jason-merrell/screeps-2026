create or replace function public.sync_ptr_experiment_benchmark()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_colony_id uuid;
  v_milestones jsonb := '{}'::jsonb;
  v_final_rcl integer;
  v_rcl_delta integer;
begin
  if new.target <> 'ptr'
     or new.name <> 'bootstrap-rcl3'
     or new.status <> 'succeeded'
     or new.result is null then
    return new;
  end if;

  select id into v_colony_id
  from public.colonies
  where target = new.target
    and shard = new.shard
    and room_name = new.room_name;

  if v_colony_id is null then
    return new;
  end if;

  select coalesce(jsonb_object_agg(key, value -> 'sample'), '{}'::jsonb)
    into v_milestones
  from jsonb_each(coalesce(new.result -> 'transitions', '{}'::jsonb));

  v_final_rcl := nullif(new.result #>> '{final,state,controller,level}', '')::integer;
  v_rcl_delta := nullif(new.result #>> '{delta,rcl}', '')::integer;

  insert into public.benchmark_samples (
    sample_key,
    colony_id,
    benchmark_name,
    runtime_sha,
    captured_at,
    metrics,
    source,
    source_ref
  ) values (
    new.experiment_key,
    v_colony_id,
    new.name,
    new.runtime_sha,
    coalesce(new.completed_at, now()),
    jsonb_build_object(
      'evidenceClass', coalesce(new.result ->> 'evidenceClass', 'live-ptr-longitudinal'),
      'sampleCount', nullif(new.result ->> 'sampleCount', '')::integer,
      'intervalMs', nullif(new.result ->> 'intervalMs', '')::integer,
      'durationMs', case
        when new.started_at is not null and new.completed_at is not null
          then greatest(0, round(extract(epoch from (new.completed_at - new.started_at)) * 1000)::bigint)
        else null
      end,
      'outcomeStatus', new.result ->> 'outcomeStatus',
      'startRcl', case when v_final_rcl is not null and v_rcl_delta is not null then v_final_rcl - v_rcl_delta else null end,
      'finalRcl', v_final_rcl,
      'finalControllerProgress', nullif(new.result #>> '{final,state,controller,progress}', '')::bigint,
      'finalControllerProgressTotal', nullif(new.result #>> '{final,state,controller,progressTotal}', '')::bigint,
      'finalWorkforce', nullif(new.result #>> '{final,state,workforce,total}', '')::integer,
      'finalWorkforceTarget', nullif(new.result #>> '{final,state,workforce,target}', '')::integer,
      'finalSpawnEnergy', nullif(new.result #>> '{final,state,spawn,energy}', '')::integer,
      'finalSpawnCapacity', nullif(new.result #>> '{final,state,spawn,capacity}', '')::integer,
      'finalConstructionSites', nullif(new.result #>> '{final,state,structures,constructionSites}', '')::integer,
      'finalExtensionSites', nullif(new.result #>> '{final,state,structures,extensionSites}', '')::integer,
      'finalExtensions', nullif(new.result #>> '{final,state,structures,extensions}', '')::integer,
      'controllerProgressDelta', nullif(new.result #>> '{delta,controllerProgress}', '')::bigint,
      'workforceDelta', nullif(new.result #>> '{delta,workforce}', '')::integer,
      'harvestedDelta', nullif(new.result #>> '{delta,harvested}', '')::bigint,
      'constructionSpendDelta', nullif(new.result #>> '{delta,constructionSpend}', '')::bigint,
      'controllerSpendDelta', nullif(new.result #>> '{delta,controllerSpend}', '')::bigint,
      'cpuAverageTotal', nullif(new.result #>> '{observability,cpu,averageTotal}', '')::numeric,
      'cpuMaxTotal', nullif(new.result #>> '{observability,cpu,maxTotal}', '')::numeric,
      'cpuBucketFinal', nullif(new.result #>> '{observability,cpu,bucket}', '')::numeric,
      'intentsAverageProposed', nullif(new.result #>> '{observability,intents,averageProposed}', '')::numeric,
      'intentsAverageAccepted', nullif(new.result #>> '{observability,intents,averageAccepted}', '')::numeric,
      'intentsAverageRejected', nullif(new.result #>> '{observability,intents,averageRejected}', '')::numeric,
      'milestoneSamples', v_milestones
    ),
    'ptr-experiment',
    regexp_replace(new.experiment_key, '^ptr-experiment:', 'github-comment:')
  )
  on conflict (sample_key) do update set
    colony_id = excluded.colony_id,
    benchmark_name = excluded.benchmark_name,
    runtime_sha = excluded.runtime_sha,
    captured_at = excluded.captured_at,
    metrics = excluded.metrics,
    source = excluded.source,
    source_ref = excluded.source_ref;

  return new;
end;
$$;

drop trigger if exists experiments_sync_ptr_benchmark on public.experiments;
create trigger experiments_sync_ptr_benchmark
after insert or update of status, result, completed_at, runtime_sha
on public.experiments
for each row
execute function public.sync_ptr_experiment_benchmark();
