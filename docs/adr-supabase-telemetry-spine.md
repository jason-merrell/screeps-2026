# ADR: Supabase-first telemetry spine

Status: Accepted

## Context

Screeps runtime code cannot make arbitrary outbound network requests. Runtime observability therefore has to leave the game through surfaces Screeps owns, primarily game state, Memory, and RawMemory segments.

Historically, GitHub Actions collectors read those surfaces and produced ZIP artifacts containing experiment samples. Supabase persisted command, experiment, benchmark, and snapshot summaries, but the longitudinal samples used for diagnosis remained artifact-first. This made historical queries, partial-run recovery, and cross-runtime analysis unnecessarily dependent on downloaded files.

## Decision

Supabase is the durable system of record for Screeps telemetry. GitHub Actions is a replaceable external collector/executor, not the data authority.

The data path is:

```text
Screeps runtime
  -> game state / Memory / RawMemory segments
  -> authenticated external collector
  -> Supabase collection run
  -> idempotent telemetry samples
  -> derived experiment / benchmark summaries
```

Screeps receives no Supabase credentials and performs no outbound writes.

GitHub Actions authenticates to Supabase Edge Functions with short-lived GitHub OIDC identity. Edge Functions verify the repository, workflow, issuer, and audience before using server-side Supabase authority.

## Collection model

A `collection_runs` row identifies one durable execution of a collector. It records colony, runtime SHA, expected sample count, cadence, status, and source request.

A `telemetry_samples` row is one immutable-by-identity observation in that run. Samples use a deterministic key derived from collection identity and sequence, making retries idempotent.

Query-critical dimensions are relational columns:

- colony
- experiment
- collection run
- sequence
- capture time
- game tick
- runtime SHA
- schema and schema version

The rich observation remains versioned JSONB so runtime instrumentation can evolve without a migration for every metric.

## Transaction semantics

Collectors persist each sample before advancing to the next observation interval.

A run therefore behaves as:

```text
start collection run
  -> sample 0 -> commit
  -> sample 1 -> commit
  -> ...
  -> sample N -> commit
  -> finalize from persisted samples
```

If the collector fails after sample 8, samples 0 through 8 remain durable and queryable. The run is marked failed rather than losing the observation window.

Experiment summaries are derived from persisted telemetry samples during finalization. The final experiment row is derived data, not the only durable evidence.

## Artifact policy

GitHub artifacts are fallback evidence, not the primary telemetry transport.

Successful Supabase-backed experiments do not upload the full longitudinal artifact. A fallback artifact may be uploaded when persistence or execution fails so a broken telemetry pipeline remains diagnosable.

Other legacy commands may continue using artifacts until migrated independently.

## FSPM implications

FSPM Activity, Task, Procedure, and KPI telemetry belongs in the longitudinal sample stream. This allows behavioral questions to be answered historically rather than only during a purpose-built experiment.

Examples include:

- Activity tenure
- Task preemption count
- Procedure transitions and retargets
- On Hold / resume frequency
- productive, travel, and idle ticks
- Activity continuity ratio
- time to first productive work
- workforce assignment coverage
- KPI closeout outcomes

These measurements should be queryable by colony, creep, runtime SHA, Task, Procedure, Activity, and time window.

## Consequences

Positive:

- partial experiments retain evidence
- longitudinal behavior is directly queryable
- runtime comparisons no longer require artifact downloads
- Screeps remains outbound-isolated
- credentials remain outside the game
- collector implementations can change without changing the telemetry authority

Tradeoffs:

- the Edge Function and schema become part of the operational control plane
- payload schemas require explicit versioning and validation
- retention and aggregation policy must eventually control longitudinal storage growth

## Follow-on

The next step after proving experiment streaming is to make recurring collection policy Supabase-driven as well: Supabase records what collection is due, an external worker claims the work, reads Screeps, and commits samples back to the same telemetry spine.
