# Screeps Architecture RFC: FSPM-Aligned Autonomous Control

Status: proposed

## Why this RFC exists

The goal is not to rename Screeps concepts after FSPM. The goal is to borrow the governance properties that make FSPM useful: explicit traceability, durable evidence, roll-up, quality measurement, accountable ownership, and controlled execution.

The current runtime already has the right low-level shape:

`perceive -> planners -> arbitration -> execution -> trace`

The missing layer is durable strategic intent above tick-level intents, plus a durable evidence spine that can explain why work exists and whether it is succeeding.

## Governance source model

The authoritative FSPM operational hierarchy is:

`Contract -> Requirement -> Deliverable -> Task -> Activity`

Execution proceeds downward through that hierarchy. Evidence and quality flow back upward:

`Activity evidence -> Task quality -> Deliverable quality -> Requirement satisfaction -> Contract health`

FSPM governance cadences then review and roll that evidence upward across Daily, Weekly, Monthly, and Quarterly horizons. Those cadences are a governance/read-model concern, not something the Screeps tick loop should imitate literally.

For Screeps, the important lesson is:

> Every material activity should be explainable upward to a durable contract-level objective, and every higher-level objective should be measurable through lower-level execution evidence.

## Proposed Screeps traceability spine

FSPM concept | Screeps concept | Persistence
---|---|---
Contract | Colony objective / operating contract | durable
Requirement | Machine-checkable condition or invariant | durable
Deliverable | Durable outcome with acceptance criteria | durable
Task | Planned unit of work | durable or leased
Activity | Tick-scale execution activity / accepted intent group | ephemeral + traced
Execution evidence | Intent result / telemetry | durable summary

Example:

`Establish and stabilize W39S23`
→ `Maintain continuous source harvesting`
→ `Establish source-1 logistics`
→ `Provide hauling capacity for source-1`
→ `move/withdraw/transfer intents`

A creep is not part of the governance spine. It is a resource temporarily allocated to work.

## Proposed runtime layers

### 1. Perception

Current home: `world/`

Produces an immutable current-tick world view from visible game state and durable memory.

### 2. World Model

New durable layer.

Stores facts that remain useful beyond one tick:

- room ownership and confidence
- source utilization history
- threat history
- route/traffic observations
- economic throughput
- construction progress
- failure/recovery history
- last-known remote-room state

This is analogous to FSPM's durable system of record and evidence base. It should be queryable independently of execution code.

### 3. Contracts

A Contract is the durable top-level operating objective for a colony or bounded strategic scope.

Examples:

- `establish-and-stabilize/W39S23`
- `defend/W39S23`
- `expand/W39S23->W40S23`

A Contract defines the outcome boundary and owns Requirements. Contracts do not generate Game API calls directly.

Empire-wide strategy may influence which Contracts exist or their priority, but it is intentionally outside the FSPM parity spine itself.

### 4. Requirements

Machine-checkable conditions derived from the Contract.

Examples:

- source utilization >= target
- spawn starvation <= threshold
- controller downgrade risk = false
- defense readiness >= threshold
- room plan exists and validates

Requirements express what must be true, not how to make it true.

### 5. Deliverables

Durable accepted outcomes that satisfy one or more Requirements.

Examples:

- `establish-source-logistics/W39S23/source-1`
- `reach-rcl3/W39S23`
- `establish-rcl2-extension-cluster/W39S23`

A Deliverable owns:

- Contract and Requirement trace
- acceptance criteria
- current health
- accountable planner/system
- active plan revision
- evidence window
- terminal state

### 6. Plans and Tasks

Plans are versioned data, not hidden object behavior.

A Plan describes how a Deliverable is expected to become true. Tasks are the durable or leased units of work produced by that Plan.

Important rule:

> Replanning creates a new revision; it does not silently rewrite history.

This gives Screeps Lab the ability to diff plan revisions and explain why the colony changed course.

### 7. Activities and tick planners

Current homes: `systems/*/plan.ts`

Tick planners consume:

- current world
- durable world model
- active Tasks

They emit typed Activities/intents only.

They do not own durable strategy.

### 8. Arbitration

Current home: `intents/arbitrate.ts`

Arbitration remains the atomic authority boundary for mutually conflicting tick intents.

Every accepted/rejected intent should carry trace identifiers back to:

`activity -> task -> deliverable -> requirement -> contract`

This makes rejection part of the evidence stream rather than an invisible implementation detail.

### 9. Execution

Current home: `intents/execute.ts`

Execution performs narrow Game API mutations. It does not decide strategy.

Actors are replaceable resources. A dead creep invalidates an allocation, not a Contract, Requirement, Deliverable, or Task.

### 10. Evidence and roll-up

Current home begins in `observability/`.

Add durable quality rollups inspired by FSPM/EQVM, without copying its business metrics literally.

Proposed cadence is game-time based rather than calendar based:

- Tick: raw execution evidence
- Short window: Activity health
- Medium window: Task quality
- Longer window: Deliverable quality
- Strategic window: Requirement satisfaction and Contract health

Possible quality spine:

`Intent Result -> Activity Quality -> Task Quality -> Deliverable Quality -> Requirement Satisfaction -> Contract Health`

Names should remain Screeps-native in code. FSPM parity is conceptual, not branding.

## FSPM parity principles

### Traceability

Nothing material should exist without an upward trace.

An Activity with no Task is suspicious. A Task with no Deliverable is suspicious. A Deliverable with no Requirement is suspicious. A Requirement with no Contract is suspicious.

### Roll-up

Higher-level health is derived from lower-level evidence rather than manually asserted.

### Accountable ownership

Each durable Deliverable has exactly one accountable system/planner, while many resources may be responsible for execution.

This mirrors the useful part of ARCI without pretending creeps are employees.

### Just Enough Information

Persist the minimum evidence needed to explain, replay, compare, and govern behavior. Do not dump raw game objects into durable storage merely because they are available.

### Governance by construction

Rules belong at authority boundaries:

- schema validation
- plan acceptance
- arbitration
- command enqueue/claim
- terminal transitions

Do not rely on individual planners or actors to remember policy.

## Relationship to Overmind-style architecture

The proposed model preserves the strongest idea from mature Screeps bots: hierarchical orchestration and specialized planners.

The divergence is deliberate:

- strategic intent is durable data, not implicit object topology
- plans are versioned records
- execution evidence is first-class
- authority boundaries are explicit and auditable
- external control-plane commands use the same governance model

The target is not an Overmind clone. It is an autonomous runtime with an inspectable management plane.

## Screeps Lab target view

Lab should eventually answer four questions for any material action:

1. What is happening?
2. Why is it happening?
3. What Contract/Requirement/Deliverable/Task does it serve?
4. Is it working?

Example card:

```
Contract: Establish and stabilize W39S23
Requirement: Maintain continuous source harvesting
Deliverable: Establish source-1 logistics
Task: Add hauling capacity
State: in_progress
Quality: 0.81
Constraint: source-1 hauling throughput
Plan revision: 4
Evidence: 93% source uptime / 2 starvation events / +14% throughput
```

## Migration sequence

1. Add trace IDs to existing planner output and observability without changing behavior.
2. Introduce durable `contract`, `requirement`, `deliverable`, and `task` types in runtime memory with schema/version migration.
3. Wrap the existing settlement room plan as a versioned plan owned by a Deliverable.
4. Add durable world-model summaries from existing snapshot/perception data.
5. Make tick planners consume active Tasks and emit traced Activities/intents.
6. Add quality rollups and expose them in Screeps Lab.
7. Only then add additional native control-plane mutation commands.

No rewrite is required. Existing planners continue to produce intents while the durable hierarchy is introduced above them.

## Immediate decision

Pause expansion of native command vocabulary until steps 1-3 exist. `inspect_room` remains useful, but it should become evidence acquisition for the world model rather than an isolated new command with no Contract -> Requirement -> Deliverable -> Task trace.

## Source notes

FSPM governance interpretation is based on the authoritative stakeholder source and current supersession record in the connected Namauu monorepo:

- `docs/plans/fspm-meeting-framework/sources/kekai-fspm-presentation.md`
- `docs/plans/fspm-meeting-framework/architecture.md`
- `docs/plans/fspm-meeting-framework/amendments.md`

The amendments are important because the framework evolved after the original implementation. In particular, priorities and review items became first-class records, ad-hoc/materiality behavior was retired, and the series/occurrence model remained the durable cadence foundation.
