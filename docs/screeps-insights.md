# Screeps insights bridge

The insights bridge gives the operator an on-demand view of Screeps without
exposing `SCREEPS_TOKEN` in chat, issue comments, or uploaded artifacts. Its
collection operations are read-only; the separately documented PTR execution
canary is a temporary, restoration-guarded mutation. Issue #5 is the persistent
command endpoint.

## World collection

World is the default target:

```text
/collect
/collect room=W1N1
/collect room=W1N1 shard=shard3
```

The collector reads world status, start-room state, owned rooms, account stats,
branch activation, and per-room status, overview, terrain, and objects. World
collection retains its legacy token behavior and does not depend on
`/api/auth/me`.

## PTR runtime preflight

PTR inspection is intentionally atomic and requires both room and shard:

```text
/collect target=ptr room=E52N38 shard=shard3
```

The resulting `runtimeReadiness` record checks:

- normal PTR world status;
- one unambiguous active branch matching the configured deployment branch;
- internally consistent, positive CPU allocation on the requested shard and no
  explicit account disablement (scheduler eligibility is not execution proof);
- the exact requested room is listed and its controller is owned by that
  account;
- the shard game clock and durable Memory schema are readable;
- Segment 99 reports the expected executing runtime build SHA, Memory schema,
  valid CPU metrics, and a fresh tick;
- the requested room's development evaluator ran on that trace tick.

The status is `ready`, `blocked`, or `unverified`. The shard game clock is a
server-wide clock, not a user heartbeat; retained Memory and Segment data are
durable state, not proof that a current loop ran. This is an execution
preflight, not release closure: `releaseClosure` is always `false`. A fresh
self-reported build SHA proves which build is executing; it is not independent
byte verification and does not prove that construction or maturity outcomes
have occurred. Those require post-deployment snapshot evidence.

During a staged schema upgrade, Segment 99 may contain the distinct
`screeps-runtime-boot-heartbeat/v1` payload. The collector retains its bounded
phase/fault evidence but never accepts it as the complete runtime trace v1
contract.

## PTR execution canary

When static readiness cannot distinguish an eligible account from an executing
user loop, the repository owner can request:

```text
/canary target=ptr room=E52N38 shard=shard3
```

The canary temporarily activates a tiny request-specific branch, collects
nonce-bound Memory and sanitized room-engine timestamps across at least three
distinct shard ticks, and restores the configured branch plus PTR activation.
Canary-loop execution and room-engine consistency are separate verdicts: stale
creep expiry, source regeneration, or road decay blocks the latter even if the
former advances. A short window with no overdue object is only `consistent`,
never affirmative proof of room-engine health. See
[PTR execution canary](./ptr-execution-canary.md) for its fail-safe transaction
and privacy contract.

## Authentication and privacy

GitHub Actions obtains `SCREEPS_TOKEN` from Infisical `/deploy` through OIDC.
The token exists only in the workflow process. Account responses are reduced to
validated CPU entitlement, allocation-change timestamp, and explicit scheduler
state evidence. Branch responses are reduced to branch name
and activation flags on both World and PTR; module source, account identifiers,
and opaque branch metadata are not copied into readiness evidence.
The canary likewise reduces room objects to numeric timestamp ranges and
overdue counts, and never writes module source, nonces, account IDs, object IDs,
or raw API bodies to its artifact.

## Artifacts

Each immutable issue-comment request produces
`screeps-insights-request-<comment-id>` with seven-day retention and a matching
completion receipt on issue #5. Manual workflow dispatch supports `world` and
`ptr`; PTR dispatch also requires an explicit room and shard and may supply an
expected runtime SHA.

See [insights-protocol.md](./insights-protocol.md) for the complete command and
idempotency contract.
