# Headless Screeps scenarios

Use the local private-server engine as the automated correctness lab between pure unit tests and PTR.

## Command bridge

Issue #5 accepts:

```text
/scenario name=head-on
/scenario name=funnel
/scenario name=crossing
/scenario name=traffic-suite
/benchmark name=traffic-suite runs=3
/benchmark name=bootstrap-suite runs=3
```

A scenario request builds the current repository, builds a dedicated scenario bundle, installs the isolated headless-server dependency under `scenario/`, constructs a deterministic room, runs the Screeps engine one tick at a time, evaluates assertions, and uploads `artifacts/screeps-insights.json`.

The native private-server tree is installed with `npm ci` from `scenario/package-lock.json`. It intentionally remains separate from pnpm's workspace links because the server launches child processes that require a standalone npm topology.

The latest available mock-server package inherits a legacy private-server dependency tree with unresolved audit findings. It is restricted to disposable local/CI test worlds, receives an allowlisted child-process environment with no repository or deployment credentials, and is never included in either production artifact; replacement or stronger sandboxing is tracked in [#192](https://github.com/jason-merrell/screeps-2026/issues/192). Do not expose this harness to public ingress or persistent data.

Every pull request now has a blocking native `production-main-smoke` CI job. It compiles the actual production `main.loop` with the candidate Git SHA for four independent 12-tick modes in deterministic private-server rooms. The normal bundle rejects any failed supervised phase. The compile-time maintenance-fault bundle must still authorize a governed spawn, create FSPM assignment evidence, execute the spawn through the engine, and complete authority, arbitration, and execution while reporting only the injected phase failure. Separate malformed-Empire and malformed-colony modes seed an existing authority container without its required root P3 before the first tick; every fresh, tick-correlated Segment 99 publication must quarantine the exact missing root while accepting no governed intent, fabricating no Activity evidence, and producing no engine side effect. The colony case also proves that production maintenance never converts corruption into new Active authority. All modes reject stale or replayed Segment 99 data, missing memory migration, colony discovery, exact runtime provenance, incomplete phase outcomes, or misleading phase-registry claims. The aggregate diagnostic artifact uploads even when any mode fails.

The issue-command workflow remains the heavier comparative engine lane: traffic scenarios exercise the dedicated movement bundle, while `bootstrap-suite` builds and runs the production `main.loop` for both baseline and candidate SHAs across three to five repetitions and a 400-tick bootstrap window.

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

A failed or infrastructure-failed scenario writes the artifact and then exits nonzero. Controlled benchmarks do the same for invalid comparisons and guarded regressions. The workflow uploads these diagnostics even when the quality gate fails.

Controlled comparisons require three to five repetitions. Three is the default and minimum; a two-run request is rejected before native dependencies or worlds are started. Every repetition records the immutable baseline and candidate SHA, fixture version, and tick budget so a green verdict cannot be inferred from a single lucky run.
