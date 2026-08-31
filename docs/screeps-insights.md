# Screeps insights bridge

The insights bridge gives the operator an on-demand, read-only view of Screeps
without exposing `SCREEPS_TOKEN` in chat, issue comments, or uploaded artifacts.
Issue #5 is the persistent command endpoint.

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
- positive CPU allocation on the requested shard and an operational account;
- the exact requested room is listed and its controller is owned by that
  account;
- the shard game clock and durable Memory schema are readable;
- Segment 99 reports the expected executing runtime build SHA, Memory schema,
  valid CPU metrics, and a fresh tick;
- the requested room's development evaluator ran on that trace tick.

The status is `ready`, `blocked`, or `unverified`. This is an execution
preflight, not release closure: `releaseClosure` is always `false`. A fresh
self-reported build SHA proves which build is executing; it is not independent
byte verification and does not prove that construction or maturity outcomes
have occurred. Those require post-deployment snapshot evidence.

## Authentication and privacy

GitHub Actions obtains `SCREEPS_TOKEN` from Infisical `/deploy` through OIDC.
The token exists only in the workflow process. Account responses are reduced to
CPU and operational-state evidence. Branch responses are reduced to branch name
and activation flags on both World and PTR; module source, account identifiers,
and opaque branch metadata are not copied into readiness evidence.

## Artifacts

Each immutable issue-comment request produces
`screeps-insights-request-<comment-id>` with seven-day retention and a matching
completion receipt on issue #5. Manual workflow dispatch supports `world` and
`ptr`; PTR dispatch also requires an explicit room and shard and may supply an
expected runtime SHA.

See [insights-protocol.md](./insights-protocol.md) for the complete command and
idempotency contract.
