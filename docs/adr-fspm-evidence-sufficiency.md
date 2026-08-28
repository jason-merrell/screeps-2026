# ADR: FSPM evidence sufficiency before behavior changes

Status: Accepted

## Context

The colony can visibly appear unfocused: creeps travel for long periods, switch targets or procedures, sit idle, or move between Tasks in ways that look inefficient. The FSPM runtime and Supabase telemetry spine now make portions of that behavior measurable.

However, observable churn is not itself proof of a scheduler defect. The same surface behavior can be caused by several different mechanisms:

- legitimate Procedure progression inside one Task
- target retargeting within one Procedure
- long but necessary travel
- environmental blocking or contention
- planner under-assignment
- arbitration loss
- intentional waiting
- incomplete Activity lifecycle accounting
- actual Task preemption or poor assignment policy

Behavior changes must therefore be grounded in evidence that can distinguish these causes. The telemetry system is allowed to conclude that there is not yet enough evidence to make a decision.

## Current proof basis

The first Supabase-backed FSPM dataset established that a measurement problem exists, but did not establish a sufficiently specific behavioral cause.

At the time this ADR was accepted, the available proof consisted of:

- 12 experiment observations spanning 21 game ticks
- one later recurring snapshot 170 ticks after that experiment window
- 5 observed creeps
- 13 Activities
- 6 Tasks
- 0 completed Activities
- therefore 0 Activity KPI closeouts

The counters showed meaningful signals:

- producer Task preemption was relatively low over the wider observed span
- producer travel was extremely high
- producer Procedure-transition counters were high
- several transporter Activities accumulated long idle periods

Those observations are sufficient to justify more measurement. They are not sufficient to justify Task-stickiness, scheduler, assignment-priority, or planner behavior changes.

The strongest reason is FSPM-specific: an Activity is the execution record that is measured against its Task KPI at completion. With zero completed Activities, there is no outcome evidence tying execution continuity or churn to actual Task quality.

## Decision

Creep behavior may not be modified solely because telemetry or visual inspection suggests poor focus.

Before changing scheduling, assignment, Task selection, Procedure selection, target selection, or preemption policy, the system must first pass an **Evidence Sufficiency Gate**.

If the available evidence cannot distinguish a persistent behavioral defect from telemetry ambiguity, transient conditions, or legitimate work, the next engineering task is to close the evidence gap rather than alter behavior.

The default decision under insufficient evidence is:

```text
observe -> identify missing evidence -> instrument -> collect -> reassess
```

not:

```text
observe -> guess cause -> change planner
```

## Required evidence dimensions

### 1. Complete Activity lifecycle

Activities must reach governed terminal completion when the Task-defined work instance is complete.

A completed Activity must record:

- Task
- assignee
- Procedure history
- start and completion ticks
- execution metrics
- outcome evidence
- KPI Score measured against the Task KPI Metric

Until representative Tasks have completed Activities and KPI closeouts, continuity metrics are diagnostic signals only and cannot establish performance quality.

### 2. Activity event history

Snapshots are state observations, not a complete causal history. A bounded Activity event journal must preserve important transitions between collection intervals.

Relevant events include:

```text
activity_opened
activity_started
procedure_entered
target_changed
activity_held
activity_resumed
activity_completed
kpi_scored
```

Events should include game tick, Activity, Task, Procedure, actor, relevant target identity, and reason/provenance when available.

The runtime may retain this journal in a bounded Screeps-owned surface such as RawMemory segments. The external collector drains or snapshots it into Supabase. Screeps itself remains outbound-isolated.

### 3. Procedure changes must be distinct from retargeting

A Procedure is a stable method or step defined by the Task. Its identity must not be conflated with the concrete target selected while executing that Procedure.

For example:

```text
Task: Produce Source Energy
Procedure: Harvest Source Energy
Target: source-123
```

Changing `source-123` to `source-456` is a **target retarget**, not a Procedure transition.

Telemetry must therefore measure these independently, including at least:

- `procedureTransitions`
- `targetRetargets`

A high retarget rate may indicate focus or selection churn even while Procedure continuity remains healthy.

### 4. Assignment coverage and waiting reason

For each living creep and observed tick, telemetry should distinguish why productive work did or did not occur.

At minimum, the state should distinguish:

- executing Activity work
- traveling as required by the Activity
- Activity intentionally On Hold
- intentionally waiting by Procedure
- planner produced no assignment
- proposed intent lost arbitration
- blocked by environment or target state
- other explicit bounded reason

A generic `idle` counter is not sufficient to diagnose under-assignment or poor focus.

### 5. Conversion and latency metrics

Continuity alone can hide expensive but technically coherent execution. An Activity that spends hundreds of ticks traveling may have good continuity while producing poor outcomes.

The evidence surface should therefore include metrics such as:

- Activity tenure
- time to first productive work
- productive ticks
- travel ticks
- current travel streak
- maximum travel streak
- idle/wait ticks by reason
- hold and resume counts
- Task preemptions
- Procedure transitions
- target retargets
- work-conversion ratio
- Activity continuity ratio
- time to completion
- KPI Score at closeout

A useful work-conversion measure is conceptually:

```text
productive ticks / eligible execution ticks
```

The exact denominator must remain explicit so legitimate waiting or On Hold time is not silently treated as execution failure.

## Evidence Sufficiency Gate

No fixed sample count is universally sufficient. Sufficiency is contextual and should be evaluated against the decision being considered.

Before a creep-behavior change is authorized, the dataset should demonstrate all of the following relevant to that change:

1. **Longitudinal coverage**
   - continuous or event-complete evidence over enough game ticks to observe repeated behavior rather than one burst

2. **Repeated work cycles**
   - multiple executions of the affected Tasks and Procedures across representative creeps

3. **Completed Activities**
   - enough governed Activity closeouts to associate execution patterns with KPI outcomes

4. **Causal observability**
   - Procedure transition, target retarget, Task preemption, waiting, travel, assignment gap, and arbitration effects can be distinguished

5. **Persistence**
   - the suspected defect occurs repeatedly across time or actors rather than only in one transient colony state

6. **Outcome correlation**
   - there is evidence that the suspected behavior materially degrades a relevant outcome such as completion time, work conversion, energy throughput, reproduction readiness, controller progress, construction progress, or Task KPI Score

If one of these dimensions is materially missing, the decision is **insufficient evidence** and the next slice should improve instrumentation or collection.

## Decision examples

The following evidence is not sufficient by itself:

> A producer had 48 Procedure transitions and spent 152 ticks traveling.

Before changing Procedure selection, determine whether those transitions are real Procedure changes or target retargets, whether the travel is necessary, whether the pattern repeats, and whether it worsens Activity outcomes.

The following is materially stronger evidence:

> Across 20 completed Produce Source Energy Activities, Activities with more than two target retargets had materially lower work-conversion ratios, longer completion time, and worse KPI closeout scores than comparable Activities without retarget churn.

That establishes a measurable behavioral defect and supports a bounded intervention.

## Engineering sequence

The focus-hardening roadmap is therefore:

```text
FSPM ontology
  -> persistent Activities
  -> Supabase longitudinal telemetry
  -> evidence completeness
  -> evidence sufficiency assessment
  -> bounded behavior experiment
  -> controlled comparison
  -> retain or revert from proof
```

Room acquisition, expansion, and other empire-level behavior are outside this sequence until colony execution is sufficiently measurable and coherent.

## Consequences

Positive:

- planner changes are tied to falsifiable evidence
- telemetry gaps become first-class engineering work rather than hidden uncertainty
- FSPM KPI closeout remains the outcome authority instead of raw command counts
- visual observations can generate hypotheses without being mistaken for proof
- behavioral experiments can be evaluated against a stable pre-change baseline

Tradeoffs:

- some obvious-looking behavior problems will intentionally remain unfixed while evidence is gathered
- Activity lifecycle and event instrumentation must become richer before optimization can proceed
- telemetry retention and aggregation will need bounded policies as longitudinal coverage grows

## Immediate follow-on

The next implementation slice is **FSPM Evidence Completeness**, not creep-focus policy.

It should add or complete:

- Activity completion and KPI closeout
- bounded Activity event journaling
- explicit target-retarget telemetry
- time-to-first-productive-work
- current and maximum travel streaks
- assignment/wait reason classification
- work-conversion metrics
- Supabase relational access to those observations

After collecting representative data, rerun the Evidence Sufficiency Gate. Only then should the planner or scheduler be changed.