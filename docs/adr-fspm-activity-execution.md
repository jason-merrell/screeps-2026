# ADR: FSPM Task, Procedure, Activity, and Intent Execution

Status: accepted

## Context

The Screeps runtime originally treated a tick-level command as an FSPM Activity and allowed planner demand to make Task records appear completed or reopened from tick to tick. That model is convenient for tracing individual intents, but it does not match the authoritative FSPM record model and cannot describe behavioral continuity coherently.

The authoritative governance definitions are maintained in `Namauu/governance-docs`:

- `execution/data/tasks.md`
- `execution/data/activities.md`
- `structure/eqvm.md`

Those definitions establish the following boundaries.

## Decision

### Task is the durable work definition

A Task defines the work required to produce a Deliverable. It owns:

- the action/outcome definition
- one or more Procedures
- Quality Description
- Quality Metric
- KPI Metric
- Task Weight
- ARCI defaults

Task lifecycle describes whether that definition is in the live work set. A Task is Active or Retired. A Task does not become Completed merely because no execution was demanded during a Screeps tick.

### Procedure is a step inside a Task

Procedures describe the granular steps, tools, checks, and sequencing used to complete a Task. Atomic work that has no independently measurable output belongs in a Procedure rather than being elevated to a sibling Task.

For Screeps, a procedure may correspond to an implementation step such as collecting energy, delivering energy, traveling to a work target, building, or upgrading when those steps contribute to one independently measurable Task outcome.

A transition from one expected Procedure to the next is not, by itself, loss of focus.

### Activity is an execution instance of exactly one Task

An Activity records one performance instance of a Task. It has exactly one parent Task and one assignee at a time.

Its lifecycle is:

`Not Started -> In Progress -> Completed`

with `On Hold` available when execution is temporarily paused and later resumed.

An Activity persists across Screeps ticks. Traveling toward a target, executing multiple Procedure steps, waiting on a valid dependency, and resuming work do not create a new Activity merely because the game tick changed.

The Activity ID is immutable for the lifetime of the execution instance.

### Intents are execution mechanics, not Activities

A Screeps intent is a low-level implementation action performed while executing the current Procedure of an Activity.

The trace chain is therefore:

`Intent -> Procedure -> Activity -> Task -> Deliverable -> Requirement -> Contract`

Arbitration may accept or reject an Intent without changing the identity of the Activity it serves.

### KPI is evaluated at Activity completion

The Task defines the Quality Description, Quality Metric, and KPI Metric before execution begins. The Activity inherits those definitions.

KPI Score is assigned when the Activity reaches Completed, after its work product or outcome has been evaluated against the Task's Quality Metric. In-progress travel or individual successful commands do not independently earn Activity KPI credit.

Completed Activity KPI scores become the evidence used for Task and higher-level EQVM rollup.

## Behavioral-coherence telemetry

The runtime must be able to tell the same story that an operator can see while watching the colony.

The first measurement layer is descriptive. It must not change scheduling policy merely to improve the metrics.

Per Activity, record enough bounded evidence to derive:

- Activity tenure
- current Procedure and Procedure tenure
- In Progress ticks
- On Hold ticks
- hold count
- resume count
- Task preemption count
- Procedure transition count
- productive work ticks
- required travel ticks
- idle or reorientation ticks
- time to completion
- KPI Score at completion

Two primary behavioral-coherence indicators are:

### Activity Continuity Ratio

The proportion of Activity time spent making useful progress or required travel toward the Task outcome.

Conceptually:

`continuity = (productive work ticks + required travel ticks) / elapsed Activity ticks`

The exact production formula may evolve as evidence quality improves, but the numerator must represent progress toward the same Activity rather than unrelated work performed by the same creep.

### Task Preemption Rate

The rate at which an assignee's In Progress Activity is placed On Hold because execution switches to a different Task before the original Activity reaches its completion condition.

Expected Procedure transitions within one Task do not count as Task preemption.

## Consequences for the current runtime

1. `createIntentTrace()` must stop manufacturing a new Activity identity from `Game.time` for every intent.
2. Task definitions must not complete/reopen based on whether a planner emits an intent in the current tick.
3. Intent traces need Procedure identity in addition to Activity and Task identity.
4. Activity lifecycle state must live in durable bounded memory rather than only in the latest observability trace.
5. Activity KPI history must contain completed Activity evaluations, not one KPI sample for each tick-level command.
6. Existing planner labels that describe atomic steps must be reviewed using the FSPM Task-or-Procedure determination rule before they are treated as independent Tasks.
7. Scheduler stickiness or focus policy changes come only after this lifecycle is observable in live evidence.

## Non-goals for the first implementation slice

- no room acquisition or expansion work
- no priority aging
- no forced scheduler stickiness
- no attempt to optimize continuity metrics by changing behavior
- no unbounded per-tick Activity history

The immediate goal is truthful ontology and evidence. Behavioral policy follows from measured failure modes.
