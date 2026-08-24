# Screeps insights command protocol

Issue #5 is a persistent command endpoint for on-demand Screeps telemetry.

Each issue comment is one immutable request. The GitHub issue comment ID is the idempotency key, so a delivery retry or workflow rerun for the same comment maps to the same logical request.

## Grammar

Exactly one command is accepted per comment:

```text
/collect
/collect room=W35S25
/collect room=E55N35 shard=shard3
```

Keys may appear only once. Supported keys are `room` and `shard`. `shard` requires `room`. Extra text, duplicate keys, unknown keys, or multiple commands are rejected.

## Transaction model

For issue-comment requests:

1. Validate the immutable comment as one command.
2. Use `github.event.comment.id` as `requestId`.
3. Acquire GitHub Actions concurrency for that `requestId`.
4. Check issue #5 for an existing completion receipt for that `requestId`.
5. If already completed, exit successfully without recollecting.
6. Otherwise collect one bounded snapshot.
7. Upload `screeps-insights-request-<requestId>`.
8. Append a completion receipt to issue #5.

A workflow rerun can therefore safely converge on the same logical result.

Manual `workflow_dispatch` remains available for operator use and uses the workflow run ID as its request ID.
