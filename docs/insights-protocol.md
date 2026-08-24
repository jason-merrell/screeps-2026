# Screeps insights command protocol

Issue #5 is a persistent command endpoint for on-demand Screeps telemetry.

Each issue comment is one immutable request. The GitHub issue comment ID is the idempotency key, so a delivery retry or workflow rerun for the same comment maps to the same logical request.

## Grammar

Exactly one command is accepted per comment:

```text
/collect
/collect room=W35S25
/collect room=E55N35 shard=shard3
/scan sector=E55N35
/scan sector=E55N35 shard=shard3
/recommend-start
/recommend-start shard=shard3
```

Command rules:

- `/collect` accepts optional `room` and `shard`; `shard` requires `room`.
- `/scan` requires `sector` and accepts optional `shard`.
- `/recommend-start` accepts only optional `shard`.
- Keys may appear only once.
- Extra text, duplicate keys, unknown keys, or multiple commands are rejected.

## Start recommendation

`/recommend-start` is the atomic pre-spawn planning operation. It:

1. Reads the current start-sector anchors offered by Screeps.
2. Scans ordinary rooms in each offered sector.
3. Keeps only neutral, unreserved rooms with at least two sources.
4. Scores candidate spawn tiles using terrain-aware path cost to sources and controller, local buildable area, distance from exits, and swamp efficiency.
5. Ranks rooms by their best spawn tile.
6. Emits the winning room, exact spawn coordinates, score breakdown, and full room ranking in one artifact.

The scorer uses the same weights as the in-game spawn advisor:

- source access: 35%
- controller access: 15%
- buildable area: 25%
- exit safety: 15%
- terrain efficiency: 10%

## Transaction model

For issue-comment requests:

1. Validate the immutable comment as one command.
2. Use `github.event.comment.id` as `requestId`.
3. Acquire GitHub Actions concurrency for that `requestId`.
4. Check issue #5 for an existing completion receipt for that `requestId`.
5. If already completed, exit successfully without recollecting.
6. Otherwise execute one bounded operation.
7. Upload `screeps-insights-request-<requestId>`.
8. Append a completion receipt to issue #5.

A workflow rerun can therefore safely converge on the same logical result.

Manual `workflow_dispatch` remains available for operator use and uses the workflow run ID as its request ID.
