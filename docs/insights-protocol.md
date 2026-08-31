# Screeps insights command protocol

Issue #5 is the repository's persistent endpoint for bounded Screeps
operations and telemetry. Each issue comment is one immutable request. Its
GitHub comment ID is the idempotency key, so a delivery retry or workflow rerun
converges on the same logical operation.

## Grammar

Exactly one command is accepted per comment. Representative valid requests are:

```text
/collect
/collect room=W35S25
/collect room=E55N35 shard=shard3
/collect target=ptr room=E52N38 shard=shard3
/scan sector=E55N35 shard=shard3
/recommend-start shard=shard3
/place-start target=ptr shard=shard3
/deploy-code target=ptr
/canary target=ptr room=E52N38 shard=shard3
/experiment name=bootstrap-rcl3 target=ptr shard=shard3
/scenario name=head-on
/benchmark name=traffic-suite runs=3
/snapshot target=ptr room=E52N38 shard=shard3
```

Command rules:

- `/collect` accepts `target`, `room`, and `shard`. Target defaults to `world`.
  World fields are optional, but PTR requires one explicit room and shard.
- `/scan` requires `sector` and accepts optional `shard`.
- `/recommend-start` accepts only optional `shard`.
- `/place-start` requires `target` and accepts optional `shard`.
- `/deploy-code` requires `target`.
- `/canary` requires `target=ptr`, one explicit `room`, and one explicit
  `shard`. It is the only command that temporarily switches the PTR
  `activeWorld` branch solely to prove bounded execution.
- `/experiment` currently requires `name=bootstrap-rcl3` and `target=ptr`; it
  accepts optional `shard`.
- `/scenario` accepts `head-on`, `funnel`, `crossing`, or `traffic-suite`.
- `/benchmark` accepts `traffic-suite` or `bootstrap-suite`; `runs` must be
  from 3 through 5 and defaults to 3.
- `/snapshot` currently requires `target=ptr` and `shard`; `room` is optional
  because the observability workflow can resolve the owned room.
- Keys may appear only once. Extra text, duplicate keys, unknown keys, or
  multiple commands are rejected before credentials are loaded.

## PTR collection assurance

PTR `/collect` binds room and shard as one atomic identity. Account-scoped room
and stats requests use the authenticated account ID; all room endpoints include
the requested shard. If the same room name appears on another shard, it cannot
replace the explicit binding.

The collector normalizes HTTP and Screeps API envelopes separately. HTTP 200
with `ok: 0`, an explicit `error`, invalid JSON, or a missing API `ok: 1` is not
trusted as successful evidence. Missing or malformed Memory and Segment 99 data
remain diagnostic and result in `unverified`; contradictory evidence results in
`blocked`.

`runtimeReadiness` is deliberately labeled `runtime-preflight` and never closes
a release. Deployment byte verification, room-plan v4 publication, maturity
demand, construction-site creation, and subsequent build progress are separate
evidence gates. CPU allocation, absence of explicit account disablement, shard
clock availability, and a fresh expected-SHA runtime publication are reported as
separate facts; none is substituted for another.

## PTR execution canary

PTR `/canary` is a mutation-scoped diagnostic, not a stronger spelling of
`/collect`. It creates and activates a tiny request-specific branch, accepts
only untorn Memory and room-engine samples on at least three distinct shard
ticks, then restores the configured branch and PTR activation. In-process
`finally` restoration is backed by a separate workflow `always()` step.

The artifact keeps canary-loop execution separate from room-engine consistency.
An expired creep, overdue partial source regeneration, or overdue road decay
blocks room-engine evidence even when the canary loop itself advances. No
module source, token, nonce, account ID, object ID, or raw API body is published.
See [ptr-execution-canary.md](./ptr-execution-canary.md) for the transaction,
privacy, verdict, and residual-risk contract.

## Start recommendation

`/recommend-start` is the atomic pre-spawn planning operation. It reads offered
start sectors, scans ordinary rooms, keeps neutral unreserved rooms with at
least two sources, and ranks terrain-aware spawn positions. The score weights
are source access 35%, controller access 15%, buildable area 25%, exit safety
15%, and terrain efficiency 10%.

## Transaction model

For issue-comment requests:

1. Validate one immutable comment and normalize its command.
2. Use `github.event.comment.id` as `requestId`.
3. Acquire GitHub Actions concurrency for that request. PTR code mutations and
   canaries share one cross-workflow concurrency key.
4. Check issue #5 for an existing completion marker.
5. Exit successfully without repeating an already completed operation.
6. Otherwise execute one bounded operation.
7. Upload `screeps-insights-request-<requestId>` when the operation uses an
   artifact.
8. Append the completion receipt and immutable marker to issue #5.

Manual `workflow_dispatch` uses the workflow run ID as its request ID. It
supports a target selector; PTR dispatch fails validation unless both room and
shard are present.
