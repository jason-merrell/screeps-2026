# Screeps Architecture RFC: FSPM-Aligned Autonomous Control

Status: proposed

> Execution semantics are governed by `docs/adr-fspm-activity-execution.md`. In particular, a Task is a durable work definition, Procedures are the steps inside that Task, an Activity is a persistent execution instance of exactly one Task, and intents are low-level execution mechanics. The older tick-scale Activity interpretation is superseded.

## Why this RFC exists

The goal is not to rename Screeps concepts after FSPM. The goal is to borrow the governance properties that make FSPM useful: explicit traceability, durable evidence, roll-up, quality measurement, accountable ownership, and controlled execution.

The current runtime already has the right low-level shape:

`perceive -> planners -> arbitration -> execution -> trace`

The missing layer is durable strategic intent above tick-level intents, plus a durable evidence spine that can explain why work exists and whether it is succeeding.

## Governance source model

The authoritative FSPM operational hierarchy is:

`Contract -> Requirement -> Deliverable -> Task -> Activity`

A Task owns one or more Procedures that define how its work is performed. An Activity instantiates one Task and carries the execution lifecycle. Intents execute the current Procedure but are not themselves FSPM Activities.

Execution proceeds downward through that hierarchy. Evidence and quality flow back upward:

`Activity evidence -> Task quality -> Deliverable quality -> Requirement satisfaction -> Contract health`

For Screeps, the important lesson is:

> Every material Activity should be explainable upward to a durable Task and every completed Activity should produce quality evidence that can roll back upward.

## Proposed Screeps traceability spine

FSPM concept | Screeps concept | Persistence
---|---|---
Contract | Colony objective / operating contract | durable
Requirement | Machine-checkable condition or invariant | durable
Deliverable | Durable outcome with acceptance criteria | durable
Task | Stable work definition with quality and procedures | durable
Procedure | Ordered/eligible execution step inside a Task | durable definition
Activity | One execution instance of exactly one Task | durable while open + bounded history
Intent | Low-level Game API action serving the current Procedure | tick-scale + traced
Execution evidence | Intent result / Activity outcome telemetry | durable bounded summary

Example:

`Establish and stabilize W39S23`
→ `Maintain continuous source harvesting`
→ `Establish source-1 logistics`
→ `Operate source logistics` (Task)
→ `Collect buffered energy` (Procedure)
→ `withdraw/move intents`

A creep is not part of the governance spine. It is a resource temporarily assigned to an Activity.

## Proposed runtime layers

### 1. Perception

Current home: `world/`

Produces an immutable current-tick world view from visible game state and durable memory.

### 2. World Model

Stores facts that remain useful beyond one tick:

- room ownership and confidence
- source utilization history
- threat history
- route/traffic observations
- economic throughput
- construction progress
- failure/recovery history
- last-known remote-room state

### 3. Contracts

A Contract is the durable top-level operating objective for a colony or bounded strategic scope. Contracts do not generate Game API calls directly.

### 4. Requirements

Machine-checkable conditions derived from the Contract. Requirements express what must be true, not how to make it true.

### 5. Deliverables

Durable accepted outcomes that satisfy Requirements. A Deliverable owns acceptance criteria, health, accountable planner/system, active plan revision, evidence window, and terminal state.

### 6. Plans, Tasks, and Procedures

Plans are versioned data, not hidden object behavior.

A Plan describes how a Deliverable is expected to become true. Tasks are stable units of independently measurable work produced or selected by that Plan. Procedures are granular execution steps owned by a Task.

Important rules:

- replanning creates a new revision; it does not silently rewrite history
- Tasks are Active or Retired definitions, not per-tick demand flags
- atomic steps with no independently measurable output are Procedures, not sibling Tasks

### 7. Activities and tick planners

Current homes: `systems/*/plan.ts`

An Activity is created from a Task when work is triggered and persists across ticks. Its lifecycle is `Not Started -> In Progress -> Completed`, with `On Hold` when execution pauses.

Tick planners consume current world state plus active work and emit intents that serve the current Procedure of an Activity. They do not manufacture a new Activity every tick.

A normal Procedure transition inside one Task is not a focus failure. Switching an assignee away from an unfinished Task should be visible as Activity hold/preemption evidence.

### 8. Arbitration

Current home: `intents/arbitrate.ts`

Arbitration remains the atomic authority boundary for mutually conflicting tick intents.

Every accepted/rejected intent should carry trace identifiers back to:

`intent -> procedure -> activity -> task -> deliverable -> requirement -> contract`

Arbitration may reject an intent without erasing or replacing the Activity it serves.

### 9. Execution

Current home: `intents/execute.ts`

Execution performs narrow Game API mutations. It does not decide strategy.

Actors are replaceable resources. A dead creep invalidates an assignment, not a Contract, Requirement, Deliverable, or Task definition.

### 10. Evidence and roll-up

Current home begins in `observability/`.

The Task defines Quality Description, Quality Metric, and KPI Metric before execution. The Activity inherits them. KPI Score is assigned at Activity completion, after the Activity outcome is evaluated against the Task Quality Metric.

In-progress travel and successful tick-level commands are evidence, but they do not independently earn Activity KPI credit.

Quality spine:

`Intent evidence -> completed Activity KPI -> Task quality -> Deliverable quality -> Requirement satisfaction -> Contract health`

Behavioral-coherence evidence should additionally expose Activity tenure, Procedure tenure, holds/resumes, Task preemptions, productive ticks, required travel ticks, idle/reorientation ticks, time to completion, Activity Continuity Ratio, and Task Preemption Rate.

## FSPM parity principles

### Traceability

Nothing material should exist without an upward trace.

An Activity with no Task is suspicious. A Task with no Deliverable is suspicious. A Deliverable with no Requirement is suspicious. A Requirement with no Contract is suspicious.

### Roll-up

Higher-level health is derived from lower-level evidence rather than manually asserted.

### Accountable ownership

Each durable Deliverable has exactly one accountable system/planner, while many resources may be responsible for execution.

### Just Enough Information

Persist the minimum evidence needed to explain, replay, compare, and govern behavior. Do not dump raw game objects into durable storage merely because they are available.

### Governance by construction

Rules belong at authority boundaries:

- schema validation
- plan acceptance
- Activity lifecycle transitions
- arbitration
- command enqueue/claim
- terminal transitions

Do not rely on individual planners or actors to remember policy.

## Relationship to Overmind-style architecture

The proposed model preserves hierarchical orchestration and specialized planners while making strategic intent, execution instances, evidence, and authority boundaries explicit and auditable.

## Screeps Lab target view

Lab should eventually answer:

1. What is happening?
2. Why is it happening?
3. What Contract/Requirement/Deliverable/Task does it serve?
4. Which Procedure is executing?
5. Is the Activity staying coherent?
6. Did the completed Activity satisfy its KPI?

Example:

```text
Contract: Establish and stabilize W39S23
Requirement: Maintain healthy colony energy operations
Deliverable: Stable bootstrap economy
Task: Sustain colony energy operations
Activity: activity:W39S23:worker-4:12840
Assignee: worker-4
State: In Progress
Procedure: Advance controller
Activity tenure: 31 ticks
Holds / resumes: 3 / 2
Task preemptions: 3
Continuity: 0.61
KPI: pending until completion
```

## Migration sequence

1. Correct Task lifecycle semantics and stop treating absent tick demand as Task completion.
2. Add Procedure identity to Task definitions and intent traces.
3. Introduce persistent Activity records with bounded history.
4. Move KPI scoring from individual commands to Activity completion.
5. Add Activity continuity and preemption telemetry without changing scheduler behavior.
6. Observe live colony behavior and establish a baseline.
7. Only then alter assignment/focus policy from measured evidence.

No rewrite is required. Existing planners can continue producing the same intents while trace and lifecycle semantics are corrected underneath them.

## Immediate decision

Do not advance room acquisition or expansion work. The immediate architecture goal is truthful Task/Procedure/Activity execution and behavioral-coherence evidence.

## Source notes

The governing record definitions are the current authoritative documents in `Namauu/governance-docs`:

- `execution/data/tasks.md`
- `execution/data/activities.md`
- `structure/eqvm.md`

The execution-specific decision is captured in `docs/adr-fspm-activity-execution.md`.
