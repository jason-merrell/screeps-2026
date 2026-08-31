# Screeps Architecture RFC: FSPM-Aligned Autonomous Control

Status: accepted, partial conformance profile

> Execution semantics are governed by `docs/adr-fspm-activity-execution.md`. In particular, a Task is a durable work definition, Procedures are the steps inside that Task, an Activity is a persistent execution instance of exactly one Task, and intents are low-level execution mechanics. The older tick-scale Activity interpretation is superseded.

## Why this RFC exists

The goal is not to rename Screeps concepts after FSPM. The goal is a documented Screeps-domain implementation of the canonical governance properties: explicit authority, traceability, durable evidence, EQVM roll-up, accountable ownership, and controlled execution.

The current runtime already has the right low-level shape:

`perceive -> planners -> arbitration -> execution -> trace`

The execution kernel now has durable, content-pinned Corporate Requirement and Corporate Deliverable authority plus Task, Procedure, Activity, Intent, and outcome evidence. The source-controlled authority package is an explicit Screeps service-principal adaptation; it is not canonical human approval. The versioned conformance profile in `docs/fspm-conformance.json` remains authoritative about incomplete OU/ARCI authority, general child-Deliverable decomposition, complete EQVM roll-up, continuously managed Portfolio decisions, and issue/risk/stakeholder governance.

## Governance source model

The authoritative hierarchy for this continuously managed Screeps scope is:

`P3 Portfolio -> Corporate Requirement -> Corporate Deliverable -> Task -> Activity`

A Task owns one or more Procedures that define how its work is performed. An Activity instantiates one Task and carries the execution lifecycle. Intents execute the current Procedure but are not themselves FSPM Activities.

Authority proceeds downward through that hierarchy. Execution evidence and EQVM quality flow back upward through the governed measurement hierarchy:

`Activity KPI -> Task QI -> Deliverable Quality Index -> Portfolio/P3 Quality Index`

Requirement satisfaction is separately demonstrated against the approved obligation and its linked Deliverable receipts. It is not a substitute name for DQI or PQI.

For Screeps, the important lesson is:

> Every material Activity should be explainable upward to a durable Task and every completed Activity should produce quality evidence that can roll back upward.

## Screeps traceability spine

FSPM concept | Screeps concept | Persistence
---|---|---
P3 Portfolio | Continuously managed empire or colony scope | durable
Corporate Requirement | Attested binding Screeps obligation | durable + append-only adapted activation history
Corporate Deliverable | Product, service, or result requiring accountable acceptance | durable; current recurring service definitions remain active across accepted occurrences
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

## Runtime layers

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

### 3. P3 Portfolios

A Portfolio is the durable P3 authority for a continuously managed empire or colony scope. It exists only where multiple components require continuous prioritization and rebalancing. Portfolios do not generate Game API calls directly.

### 4. Requirements

Approved binding obligations express what is authorized and why, not how to perform it. The current catalog is derived from the immutable Screeps Colony Operations Policy and activated top-down from an exact, versioned, content-pinned package. Approval-shaped projections are backed by immutable content-hashed adapted activation events created at the package-import tick. The named source-controlled service principal preserves autonomous execution authority but remains an explicit adaptation until #164 supplies the canonical human Accountable chain.

### 5. Deliverables

Durable products, services, or results that satisfy Requirements. Each current Deliverable owns category/type, scope and output, all evaluation factors, Quality Description, Quality Metric, a three-part receipt contract, completed-Activity-derived append-only `received` evidence, a package-bound service-principal acceptance predicate, exact integer sibling weight, revision, and lifecycle state. A receipt carries a compact immutable completion snapshot so the live Activity registry remains bounded. `received` is not accountable acceptance. A separate immutable decision ledger records accepted/rejected/disputed review and allows acceptance only for satisfactory or exceptional terminal KPI evidence. Chain-independent count/digest anchors expose newest-suffix deletion in the receipt, decision, and retirement ledgers.

The current Deliverables are recurring services: an accepted decision closes one occurrence while the durable definition stays Active. No completion API exists until a separately governed service-closure criterion is approved. This autonomous decision is not canonical human acceptance. Retirement uses a distinct hash-chained lifecycle ledger and blocks the current package from execution pending a reviewed superseding revision. General one-level child decomposition remains #176; human Accountable authority and acceptance remain #164; complete quality roll-up remains #136.

Receipt capture and receipt decision are explicit, separately atomic authority APIs, not an automatic production-loop reconciliation path. The retained ledgers currently have no acknowledged bounded archive, so #194 must land before automatic occurrence capture is enabled. Until then, the APIs establish fail-closed semantics without claiming complete live occurrence evidence.

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

`intent -> procedure -> activity -> task -> deliverable -> requirement -> P3`

Arbitration may reject an intent without erasing or replacing the Activity it serves.

### 9. Execution

Current home: `intents/execute.ts`

Execution performs narrow Game API mutations. It does not decide strategy.

Actors are replaceable resources. A dead creep invalidates an Activity assignment, not its P3, Requirement, Deliverable, Task, or Activity identity.

### 10. Evidence and roll-up

Current home begins in `observability/`.

The Task defines Quality Description, Quality Metric, and KPI Metric before execution. The Activity inherits them. KPI Score is assigned at Activity completion, after the Activity outcome is evaluated against the Task Quality Metric.

In-progress travel and successful tick-level commands are evidence, but they do not independently earn Activity KPI credit.

Canonical quality spine:

`Intent evidence -> Accountable-validated Activity KPI -> Task QI -> Task-Weight-adjusted DQI -> Deliverable-Weight-adjusted P3/PQI`

The current room operational-health measurements are diagnostics, not EQVM. They must remain separately named and cannot earn DQI or P3/PQI credit.

Behavioral-coherence evidence should additionally expose Activity tenure, Procedure tenure, holds/resumes, Task preemptions, productive ticks, required travel ticks, idle/reorientation ticks, time to completion, Activity Continuity Ratio, and Task Preemption Rate.

## FSPM conformance principles

### Traceability

Nothing material should exist without an upward trace.

An Activity with no active Task is invalid. A Task with no active Deliverable is invalid. A Deliverable with no approved Requirement is invalid. A Requirement with no active P3 is invalid. Missing, retired, or mismatched ancestry fails closed at the authority boundary.

### Roll-up

Canonical quality is derived from accepted lower-level evidence through the governed EQVM weights and formulas; operational health remains a separate diagnostic product.

### Accountable ownership

Canonical AI-native FSPM requires exactly one human Accountable for every P3 component. Creeps and runtime systems may be Responsible AI Performers; they are never Accountable. This authority model remains an explicit gap under #164.

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

The model preserves hierarchical orchestration and specialized planners while making strategic intent, execution instances, evidence, and authority boundaries explicit and auditable.

## Screeps Lab target view

Lab should eventually answer:

1. What is happening?
2. Why is it happening?
3. What P3/Requirement/Deliverable/Task does it serve?
4. Which Procedure is executing?
5. Is the Activity staying coherent?
6. Did the completed Activity satisfy its KPI?

Example:

```text
P3: portfolio:colony:W39S23
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

## Conformance sequence

1. Keep the machine-readable conformance profile synchronized with the pinned governance SHA.
2. Enforce exact active P3-to-Procedure ancestry before an intent can create or resume an Activity.
3. Preserve content-pinned, top-down Requirement and Deliverable activation; planner and intent paths remain read-only consumers of authority.
4. Implement OU/ARCI authority with one human Accountable and explicit Responsible AI Performer identity.
5. Complete general one-level child-Deliverable decomposition and governed replacement packages.
6. Complete inherited Activity scheduling and schema semantics.
7. Separate operational health from canonical EQVM and implement Activity KPI to Task QI to DQI to P3/PQI receipts.
8. Add durable acknowledgment, gap detection, and as-of history before bounded runtime evidence is evicted, including the receipt/decision checkpoint protocol in #194.
9. Implement continuously managed Portfolio decisions and Issue, Risk, and Stakeholder registers.

No rewrite is required. Existing planners can continue producing the same intents while authority, records, quality, and portfolio behavior are hardened underneath them. Capability expansion must not bypass those gates.

## Source notes

The pinned authority is `Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`. The reviewed source set includes:

- `execution/data/p3.md`
- `execution/data/corporate-requirements.md`
- `execution/data/corporate-deliverables.md`
- `execution/data/tasks.md`
- `execution/data/activities.md`
- `structure/eqvm.md`
- `structure/fspm-framework.md`

The execution-specific decision is captured in `docs/adr-fspm-activity-execution.md`. `docs/fspm-conformance.json` is the machine-checkable implementation map; it must be validated rather than inferring parity from this narrative.
