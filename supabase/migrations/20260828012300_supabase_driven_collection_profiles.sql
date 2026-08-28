create table if not exists public.collection_profiles (
  id uuid primary key default gen_random_uuid(),
  profile_key text not null unique,
  colony_id uuid not null references public.colonies(id) on delete cascade,
  collector text not null default 'snapshot',
  enabled boolean not null default true,
  cadence_seconds integer not null check (cadence_seconds >= 300 and cadence_seconds <= 86400),
  next_due_at timestamptz not null default now(),
  last_enqueued_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (collector in ('snapshot'))
);

create index if not exists collection_profiles_due_idx
  on public.collection_profiles (next_due_at)
  where enabled = true;

create or replace function public.enqueue_due_collection_commands(p_limit integer default 4)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_profile record;
  v_key text;
  v_count integer := 0;
begin
  if p_limit < 1 or p_limit > 32 then
    raise exception 'collection enqueue limit out of range';
  end if;

  for v_profile in
    select
      p.id,
      p.profile_key,
      p.collector,
      p.cadence_seconds,
      p.next_due_at,
      p.config,
      c.target,
      c.shard,
      c.room_name
    from public.collection_profiles p
    join public.colonies c on c.id = p.colony_id
    where p.enabled = true
      and p.next_due_at <= now()
    order by p.next_due_at asc, p.id asc
    for update of p skip locked
    limit p_limit
  loop
    v_key := format(
      'profile:%s:%s',
      regexp_replace(v_profile.profile_key, '[^A-Za-z0-9:._-]', '_', 'g'),
      extract(epoch from v_profile.next_due_at)::bigint
    );

    insert into public.commands (
      command_key,
      command_type,
      target,
      shard,
      room_name,
      payload,
      status
    ) values (
      v_key,
      'snapshot',
      v_profile.target,
      v_profile.shard,
      v_profile.room_name,
      jsonb_build_object(
        'source', 'collection-profile',
        'profileId', v_profile.id,
        'profileKey', v_profile.profile_key,
        'collector', v_profile.collector,
        'scheduledFor', v_profile.next_due_at,
        'config', v_profile.config
      ),
      'pending'
    )
    on conflict (command_key) do nothing;

    if found then
      insert into public.command_events (command_id, event_type, detail)
      select id, 'queued', jsonb_build_object(
        'source', 'collection-profile',
        'profileId', v_profile.id,
        'profileKey', v_profile.profile_key,
        'scheduledFor', v_profile.next_due_at
      )
      from public.commands
      where command_key = v_key;
      v_count := v_count + 1;
    end if;

    update public.collection_profiles
    set last_enqueued_at = now(),
        next_due_at = now() + make_interval(secs => v_profile.cadence_seconds),
        updated_at = now()
    where id = v_profile.id;
  end loop;

  return v_count;
end;
$$;

comment on table public.collection_profiles is 'Supabase-owned recurring Screeps collection policy. External workers only wake, claim due commands, execute, and persist results.';

insert into public.collection_profiles (
  profile_key,
  colony_id,
  collector,
  enabled,
  cadence_seconds,
  next_due_at,
  config
)
select
  'ptr:shard3:E52N38:runtime-observability',
  c.id,
  'snapshot',
  true,
  300,
  now(),
  jsonb_build_object('observabilitySegment', 99)
from public.colonies c
where c.target = 'ptr' and c.shard = 'shard3' and c.room_name = 'E52N38'
on conflict (profile_key) do update set
  colony_id = excluded.colony_id,
  enabled = excluded.enabled,
  cadence_seconds = excluded.cadence_seconds,
  config = excluded.config,
  next_due_at = least(public.collection_profiles.next_due_at, now()),
  updated_at = now();
