# ADR: Fault-contained runtime phases and CPU pressure policy

## Status

Accepted for the first runtime-supervisor slice. GitHub issue #186 remains open for per-colony fairness, scale receipts, and full phase coverage.

## Context

The runtime already classified the CPU bucket as `critical`, `constrained`, `normal`, or `surplus`, but every planner still ran every tick and an exception in any planner aborted all later work. That made bucket state descriptive rather than operational and allowed optional construction work to suppress defense, spawning, or economy execution.

## Decision

`packages/runtime/src/runtime/supervisor.ts` is the sole phase-policy registry. Each phase declares:

- a `survival`, `mandatory`, or `deferrable` execution class;
- deterministic cadence for every CPU mode;
- soft and hard phase budget ratios;
- a bounded persistent CPU sample window;
- completed, skipped, or failed outcome evidence with a structured skip reason.

Defense, spawning, and economy are survival lanes and are never skipped by cadence or the optional-work deadline. Settlement and construction are deferrable: their critical/constrained cadence is deterministic and their last-run tick is persisted, so a global reset cannot indefinitely restart the wait. Mandatory governance, arbitration, execution, and Activity-evidence phases run every tick.

Planner exceptions are contained at their phase boundary. A failed planner contributes no intents, records a bounded diagnostic, and cannot prevent a later planner from running. FSPM lifecycle/quality maintenance and FSPM execution authority are separate boundaries: a maintenance exception preserves the proposals already created by survival planners, but every proposal must still pass the independent authority snapshot. If authority validation itself throws, the accepted set is empty. Arbitration and execution likewise use empty fail-closed fallbacks.

The global optional-work deadline reserves explicit CPU headroom at 1, 10, and 50 CPU limits. Survival/mandatory work may cross that deadline because interrupting synchronous Screeps code safely is impossible; a post-run hard-budget state makes such overruns visible rather than pretending they were preempted.

Runtime Memory schema v7 persists phase attempts, failures, skips, last-run ticks, consecutive failures, and at most 128 CPU samples per phase. The observability trace exports the current phase outcomes and nearest-rank p50/p95/p99 values.

The trace labels its same-tick `cpu.total` boundary as occurring before Segment 99 fitting and publication. After the segment write, the runtime records an outer final measurement in persistent supervisor Memory; the next trace carries that exact prior-tick total and observability cost with its tick and write outcome. This one-tick reconciliation avoids presenting an impossible self-referential serialization measurement as exact.

## Safety properties

- Unknown errors become stable bounded strings; they do not escape the planner boundary.
- Skipped work never fabricates intents or successful evidence.
- A planner failure cannot authorize or execute another planner's stale output.
- Critical CPU policy never deliberately skips defense, workforce preservation, or economy service.
- Deferrable cadence is deterministic and bounded by the persisted last-run tick.

## Known limits

This slice does not yet provide per-colony round-robin fairness, asynchronous hard interruption, scale-calibrated budgets, or fault containment around Memory migration and perception. Current percentile evidence is a bounded rolling window, not a durable longitudinal benchmark. Those are still required by #186 and #133 before the runtime-supervisor lane can be closed.

## Verification

`packages/runtime/test/runtime/supervisor.test.ts` exercises deadline headroom, all four planner failure boundaries, critical survival behavior, bounded cadence, persisted state, and percentile calculation. The blocking production-main private-server gate runs both a normal bundle and a compile-time maintenance-fault bundle; the latter must retain governed spawning Activity evidence and an engine-observed spawn effect while only the injected maintenance phase reports failure. Full runtime typecheck, tests, build, and controlled private-server receipts remain release gates.
