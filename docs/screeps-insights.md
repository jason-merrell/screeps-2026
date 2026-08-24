# Screeps insights bridge

The insights bridge gives ChatGPT an on-demand, read-only view of operational Screeps world data without exposing `SCREEPS_TOKEN` in chat or GitHub.

## Trigger

Issue #5 is the persistent bridge trigger.

Comment:

```text
/collect
```

To inspect a specific room before ownership or vision:

```text
/collect W1N1
```

Only comments from the repository owner are allowed to start the job. The workflow can also be run manually with an optional room input.

## Authentication

The workflow reuses the existing `SCREEPS_TOKEN` from Infisical `/deploy` through GitHub OIDC. The token is injected only into the workflow process and is never written to the artifact.

## Snapshot

The collector requests operational endpoints such as world status, start room, rooms, branches, stats, and per-room status, overview, encoded terrain, and room objects. Individual Screeps requests fail softly so a narrowly scoped token produces a partial snapshot instead of losing the entire diagnostic run.

The result is uploaded as `screeps-insights-<run-id>` with a seven-day retention period.
