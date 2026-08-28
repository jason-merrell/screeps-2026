# ADR: FSPM performer reassignment for Screeps Activities

## Status

Accepted for the orphan-Activity lifecycle slice.

## Authoritative governance source

This decision was reviewed against `Namauu/governance-docs` at commit:

`02d581886a759d19044ff91a80d743fa042f23f7`

Primary source: `execution/data/activities.md`.

Relevant governed semantics:

- an Activity is one execution instance of exactly one Task;
- `In Progress` means work is actively underway;
- `On Hold` means work is paused with plans to resume;
- the Activity Assignee may change during the Activity lifecycle;
- assignee changes belong in the Activity audit history;
- KPI Score is assigned when the Activity is Completed, not when a performer becomes unavailable.

## Decision

A Screeps creep is a performer, not the work instance.

When an Activity's assigned creep disappears, the Activity does not complete and does not remain `In Progress`. The runtime transitions unfinished work to `On Hold` with an explicit performer-unavailable reason. No KPI Score or Task QI sample is produced by that transition.

A replacement creep may resume the same Activity only when its accepted intent identifies the same governed Task and the same concrete target as the orphaned work. This exact-target rule is intentionally conservative. Matching only the Task is insufficient because two performers may legitimately execute separate instances of the same Task against different sources, structures, controllers, or other targets.

On valid replacement:

1. the existing Activity ID is retained;
2. the Activity Assignee changes to the replacement creep;
3. an `activity_reassigned` lifecycle event records the previous Assignee;
4. the Activity resumes through the normal `activity_resumed` transition;
5. Procedure and target continuity remain governed by the existing Activity lifecycle rules.

If no exact-target orphan exists, the replacement's accepted intent opens or resumes work through the normal Activity binding path. The runtime does not guess that unrelated work is the orphan's continuation.

## Authority boundary

No creep-memory ownership record, affinity table, or parallel scheduler registry is introduced.

- `Memory.colonies[*].fspm.activities` remains the work-instance authority.
- `Game.creeps` supplies current performer liveness.
- accepted intents supply the current governed work claim.
- Activity lifecycle events supply the audit history.

This avoids creating a second source of truth for execution ownership.

## Quality boundary

Performer disappearance is not evidence that the Task outcome was achieved. Therefore it cannot call Activity completion, assign KPI Score, or affect Task QI as a completed Activity.

A later legitimate completion is evaluated only after the resumed Activity reaches its Task-specific terminal condition through normal execution evidence.

## Consequences

Positive:

- dead creeps no longer leave false `In Progress` Activities indefinitely;
- resumable work retains Activity continuity across performer replacement;
- reassignment is auditable instead of silently rewriting the Assignee;
- KPI attribution remains tied to completed work rather than performer lifecycle;
- bounded observability can distinguish genuinely resumable work from ghost execution.

Trade-offs:

- exact-target matching may leave an old Activity On Hold when the planner intentionally chooses a different concrete target for a replacement performer;
- broader semantic reassignment, if ever needed, requires explicit governed evidence rather than heuristic Task-only matching.

## Validation

The implementation must retain regression coverage for:

- performer loss while work is `In Progress`;
- no false completion or KPI on performer loss;
- exact Task + target reassignment preserving Activity ID;
- same Task + different target refusing to hijack the orphaned Activity;
- live PTR evidence that dead-assignee Activities stop remaining falsely `In Progress`.
