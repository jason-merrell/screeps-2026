# Headless Screeps scenarios

Use the local private-server engine as the automated correctness lab between pure unit tests and PTR.

## Command bridge

Issue #5 accepts:

```text
/scenario name=head-on
/scenario name=funnel
/scenario name=crossing
/scenario name=traffic-suite
```

A scenario request builds the current repository, builds a dedicated scenario bundle, installs the isolated headless-server dependency under `scenario/`, constructs a deterministic room, runs the Screeps engine one tick at a time, evaluates assertions, and uploads `artifacts/screeps-insights.json`.

## Testing contract

- Unit/replay tests answer whether pure planning/state transitions are correct.
- Headless scenarios answer whether behavior survives the real Screeps engine under deterministic pathological worlds.
- Browser Survival remains useful for visual debugging and breakpoints.
- PTR answers what the behavior costs on the real hosted server runtime.

Do not compare headless/private-server CPU values directly with PTR/MMO CPU measurements.

## Traffic scenarios

### `head-on`

Two MOVE-only creeps are staged at opposite ends of a one-tile corridor and exchange destinations with unequal priorities. The scenario passes when both reach the opposite endpoint before the deadline without deadlock.

### `funnel`

Three MOVE-only creeps approach a shared central junction and leave through nearby destinations. The scenario stresses merge ordering and congestion recovery.

### `crossing`

Four MOVE-only creeps traverse opposite cardinal routes through one central junction. The scenario stresses simultaneous occupancy conflicts and priority ordering.

### `traffic-suite`

Runs all traffic scenarios in isolated fresh worlds and reports each result plus a suite-level pass/fail.

## Artifact shape

The artifact contains the request, engine/package versions, scenario definition, per-tick timeline, final assertions, and aggregate movement metrics including cached-path attempts, path finds, stuck requests, congestion repaths, swap attempts, and successful swaps.

A failing scenario still writes the artifact before the request completes so the failure can be inspected remotely.
