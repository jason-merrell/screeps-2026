# PTR execution canary

The PTR execution canary is a bounded diagnostic for the narrow question that
static deployment and readiness evidence cannot answer: is authenticated user
code receiving ticks on one exact shard, and is the selected room engine state
free of an already-overdue processing obligation?

It is never run by deployment, collection, or a schedule. The repository owner
must submit one atomic issue #5 request:

```text
/canary target=ptr room=E52N38 shard=shard3
```

The result is diagnostic evidence, not release closure. The generated loop
issues no game intents, but the transaction does temporarily replace World
automation and write one isolated Memory key. It does not prove construction or
maturity outcomes.

## Bounded transaction

The workflow serializes canaries, PTR deployments, and PTR experiments under
the same repository concurrency key. One invocation then:

1. Requires exactly one `activeWorld` branch and requires it to be the
   configured restore branch (`SCREEPS_BRANCH`, default `default`).
2. Persists a local restoration receipt before the first canary-owned remote
   mutation.
3. Creates `ptr-canary-<request-id>` from a tiny `defaultModules` payload. It
   does not clone, download, log, or persist the production module as part of
   the canary.
4. Uploads and byte-verifies only the generated canary module.
5. Switches `activeWorld` to the canary and requests PTR activation.
6. Accepts only bracketed samples whose `/api/game/time` value is unchanged
   before and after the Memory and room-object reads.
7. Requires at least three distinct shard ticks and three nonce-bound canary
   loop ticks. Each loop tick also records whether the requested room was
   visible at that exact `Game.time`.
8. Restores the configured branch, submits a shard-qualified `null`
   neutralization for `Memory.__ptrExecutionCanary`, requests activation,
   deletes the inactive temporary branch, and verifies the restored branch.

Every Screeps HTTP exchange, including response-body decoding, has a 10-second
deadline and abort signal. The mutation step has a five-minute workflow ceiling;
the independent `always()` restoration step then receives its own three-minute
window. A stalled socket therefore cannot consume the cleanup window or leave
the temporary branch active until GitHub's multi-hour default job timeout.

Restoration runs twice by design: once in the Node process's `finally` path and
again in a separate GitHub Actions `always()` step. A rerun also recognizes and
repairs the same request's stale active canary branch before doing new work.
These controls cover ordinary API, assertion, and process failures. They cannot
make Screeps and GitHub Actions a distributed transaction: simultaneous loss of
the runner after the branch switch and before either restoration path remains a
platform-outage risk. Rerunning the same immutable request is the recovery path.
While the canary is active, normal defense, spawning, economy, and construction
intents are paused for the sampled ticks. This command is therefore reserved for
bounded incident diagnosis, never routine monitoring.

## Two separate verdicts

Canary loop execution and room processing are not interchangeable:

- `canary.execution` proves nonce-bound Memory advancement across at least
  three distinct shard ticks, including room visibility at those loop ticks.
- `canary.roomEngine` inspects only numeric engine timestamps and counts. It
  never publishes object IDs, user IDs, names, positions, or arbitrary object
  fields.

The room-engine classifier reports `blocked` when a sampled object contradicts
the shard clock:

- a creep still exists with `ageTime <= shardTick`;
- a non-full source still exists with
  `nextRegenerationTime <= shardTick`; or
- a road still exists with `nextDecayTime <= shardTick`.

No overdue obligation produces `consistent`, not “healthy”: absence of a
contradiction during a short window is not affirmative proof that every room
processor ran. A room without any time-bearing objects is `unverified`. The
overall canary passes only when loop execution passes, room evidence is
consistent, and restoration is independently complete.

## Artifact and privacy contract

`artifacts/screeps-insights.json` contains the canonical request, short source
fingerprint and byte count, sanitized samples, the two verdicts, and both
restoration results. It deliberately excludes:

- `SCREEPS_TOKEN` and authorization headers;
- account, user, branch-document, and game-object IDs;
- branch modules or any other source text;
- raw API envelopes and server error text; and
- the nonce written by the temporary module.

Failures use bounded stage/code pairs. A blocked or failed diagnostic verdict is
still a successfully completed request and is carried by the artifact rather
than the workflow exit code. The workflow fails only when the independent
restoration receipt is invalid or external restoration cannot be verified; a
successful issue completion receipt is written only after that safety step.

## Required token endpoints

The Infisical `/deploy` token needs PTR scope for:

- `GET /ptr/api/user/branches`;
- `POST /ptr/api/user/clone-branch`;
- `POST` and `GET /ptr/api/user/code`;
- `POST /ptr/api/user/set-active-branch`;
- `POST /ptr/api/user/activate-ptr`;
- `GET /ptr/api/user/world-status`;
- `GET /ptr/api/game/time`;
- `GET` and `POST /ptr/api/user/memory`;
- `GET /ptr/api/game/room-objects`; and
- `POST /ptr/api/user/delete-branch`.

Screeps' authenticated HTTP endpoints are intentionally treated as an
undocumented control plane: every HTTP response and Screeps `ok` envelope is
validated independently, and any ambiguity fails closed.
