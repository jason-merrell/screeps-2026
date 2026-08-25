# Screeps Architecture RFC: FSPM-Aligned Autonomous Control

Status: proposed

## Why this RFC exists

The goal is not to rename Screeps concepts after FSPM. The goal is to borrow the governance properties that make FSPM useful: explicit traceability, durable evidence, roll-up, quality measurement, accountable ownership, and controlled execution.

The current runtime already has the right low-level shape:

`perceive -> planners -> arbitration -> execution -> trace`

The missing layer is durable strategic intent above tick-level intents, plus a durable evidence spine that can explain why work exists and whether it is succeeding.

## Governance source model

The authoritative FSPM meeting material defines an upward traceability chain:

`Activity -> Task -> Deliverable -> Requirement -> Strategic Priority -> Core Purpose`

It also defines a governance roll-up chain:

`Daily -> Weekly -> Monthly -> Quarterly`

Operational signals are reviewed at the lower cadence, quality is measured and rolled upward, and higher cadences consume the summarized evidence. FSPM therefore behaves less like a traditional task hierarchy and more like a traceable evidence-and-governance system.

For Screeps, the important lesson is:

> Every action should be explainable upward to a durable objective, and every objective should be measurable downward through operational evidence.

## Proposed Screeps traceability spine

FSPM concept | Screeps concept | Persistence
---|---|---
Core Purpose | Empire purpose / strategic doctrine | durable
Strategic Priority | Empire priority | durable
Requirement | Colony requirement / invariant | durable
Deliverable | Outcome contract | durable
Task | Work package | durable or leased
Activity | Tick-scale activity / accepted intent group | ephemeral + traced
Execution evidence | Intent result / telemetry | durable summary

Example:

`Survive and expand`
→ `Stabilize W39S23`
→ `Maintain continuous source harvesting`
→ `Establish source-1 logistics`
→ `Supply source-1 hauling capacity`
→ `move/withdraw/transfer intents`

A creep is not part of the strategic spine. It is a resource temporarily allocated to work.

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

### 3. Strategic Priorities

Durable empire-level priorities such as:

- survive
- stabilize owned rooms
- increase energy throughput
- reach RCL milestone
- expand
- defend

Priorities do not generate Game API calls directly.

### 4. Requirements

Machine-checkable conditions derived from priorities.

Examples:

- source utilization >= target
- spawn starvation <= threshold
- controller downgrade risk = false
- defense readiness >= threshold
- room plan exists and validates

Requirements are closer to invariants than tasks.

### 5. Deliverables

Durable outcome contracts with explicit success criteria.

Examples:

- `stabilize-economy/W39S23`
- `establish-source-logistics/W39S23/source-1`
- `reach-rcl3/W39S23`
- `establish-rcl2-extension-cluster/W39S23`

A deliverable owns:

- requirement trace
- success criteria
- current health
- accountable planner/system
- active plan revision
- evidence window
- terminal state

### 6. Plans and Work Packages

Plans are versioned data, not hidden object behavior.

A plan describes how a deliverable is expected to become true. Work packages are executable slices of that plan.

Important rule:

> Replanning creates a new revision; it does not silently rewrite history.

This gives Screeps Lab the ability to diff plan revisions and explain why the colony changed course.

### 7. Tick planners

Current homes: `systems/*/plan.ts`

Tick planners consume:

- current world
- durable world model
- active work packages

They emit typed intents only.

They do not own durable strategy.

### 8. Arbitration

Current home: `intents/arbitrate.ts`

Arbitration remains the atomic authority boundary for mutually conflicting tick intents.

Every accepted/rejected intent should carry trace identifiers back to:

`activity -> work package -> deliverable -> requirement -> priority`

This makes rejection part of the evidence stream rather than an invisible implementation detail.

### 9. Execution

Current home: `intents/execute.ts`

Execution performs narrow Game API mutations. It does not decide strategy.

Actors are replaceable resources. A dead creep invalidates an allocation, not a goal.

### 10. Evidence and roll-up

Current home begins in `observability/`.

Add durable quality rollups inspired by FSPM/EQVM, without copying its business metrics literally.

Proposed cadence is game-time based rather than calendar based:

- Tick: raw execution evidence
- Short window: operational health
- Medium window: deliverable quality
- Long window: colony quality
- Strategic window: empire priority performance

Possible quality spine:

`Intent Result -> Work Quality -> Deliverable Quality -> Colony Quality -> Empire Quality`

Names should remain Screeps-native in code. FSPM parity is conceptual, not branding.

## FSPM parity principles

### Traceability

Nothing material should exist without an upward trace.

A work package with no deliverable is suspicious. A deliverable with no requirement is suspicious. An empire priority with no measurable evidence is decorative.

### Roll-up

Higher-level health is derived from lower-level evidence rather than manually asserted.

### Accountable ownership

Each durable deliverable has exactly one accountable system/planner, while many resources may be responsible for execution.

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
3. What higher objective does it serve?
4. Is it working?

Example card:

```
Deliverable: Stabilize W39S23 economy
State: in_progress
Quality: 0.81
Trace: Empire Survival -> Colony Stability -> Economy Stability
Constraint: source-1 hauling throughput
Plan revision: 4
Current work: add hauling capacity
Evidence: 93% source uptime / 2 starvation events / +14% throughput
```

## Migration sequence

1. Add trace IDs to existing planner output and observability without changing behavior.
2. Introduce durable `deliverable` and `requirement` types in runtime memory with schema/version migration.
3. Wrap the existing settlement room plan as a versioned plan owned by a deliverable.
4. Add durable world-model summaries from existing snapshot/perception data.
5. Add work packages between durable plans and tick planners.
6. Add quality rollups and expose them in Screeps Lab.
7. Only then add additional native control-plane mutation commands.

No rewrite is required. Existing planners continue to produce intents while the durable hierarchy is introduced above them.

## Immediate decision

Pause expansion of native command vocabulary until steps 1-3 exist. `inspect_room` remains useful, but it should become evidence acquisition for the world model rather than an isolated new command with no strategic trace.

## Source notes

FSPM governance interpretation is based on the authoritative stakeholder source and current supersession record in the connected Namauu monorepo:

- `docs/plans/fspm-meeting-framework/sources/kekai-fspm-presentation.md`
- `docs/plans/fspm-meeting-framework/architecture.md`
- `docs/plans/fspm-meeting-framework/amendments.md`

The amendments are important because the framework evolved after the original implementation. In particular, priorities and review items became first-class records, ad-hoc/materiality behavior was retired, and the series/occurrence model remained the durable cadence foundation.
