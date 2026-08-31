# ADR: FSPM General Project candidate for mature-base development

## Status

Accepted for the definition-only portion of #176. This decision does not
authorize, activate, persist, execute, receipt, accept, or complete a live
Project.

## Authoritative governance source

This decision was reviewed against
`Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`,
especially:

- `execution/data/p3.md` for the Project creation test, Type/Sub-Type,
  hierarchy, naming, schedule, and immutability rules;
- `execution/data/corporate-requirements.md` for exact Requirement Verbiage;
- `execution/data/corporate-deliverables.md` for Product/Result
  discrimination, one-level Child Deliverables, weights, and Receipt
  Validation; and
- `execution/processes/validation-rule-catalog.md` for structural, weight,
  task, evidence, and ARCI validation rules.

## Context

World is the persistent Screeps product and runtime mission. It is not a fourth
FSPM P3 Type. Permanent colony operations remain under
`portfolio:colony:<room>`, a continuously managed Colony Portfolio.

Developing a newly owned room to a mature operating base is different. It is a
discrete temporary endeavor with a unique end state, a defined start and end,
and specified Product and Result Deliverables.
The work is operational rather than revenue-generating and does not coordinate
multiple Projects. The scope therefore satisfies the substantive General
Project classification test and fails the tests for a Sales Project, Program,
Portfolio, routine operation, and single Task.

FSPM's creation trigger separately requires the endeavor to be authorized or
committed. The definition-only candidate can retain a service-principal
attestation of a proposed schedule, but that attestation is not canonical
authorization and cannot create the canonical record. A Project exists only
after a future governed activation proves the missing authority and publishes
the aggregate atomically; this slice stops before that boundary.

The source obligation is pinned in
`docs/screeps-mature-base-development-policy.md`. The projected Corporate
Requirement's `Requirement Verbiage` must carry `§ Binding obligation` as its
first line and reproduce the obligation verbatim on the following line. The
locator is not stored in a parallel field.

## Decision

### P3 identity and hierarchy

The candidate is a direct child of the Colony Portfolio:

```text
COLONY-PORTFOLIO-<room> Operations
└── COLONY-<room>-PROJ-Mature Operating Base Development G<generation>
```

Its governed classification and identity are:

- Type: `project`
- Sub-Type: `general_project`
- ID: `project:colony:<room>:mature-base-development:g<generation>`
- Name: `COLONY-<room>-PROJ-Mature Operating Base Development G<generation>`
- Parent: `portfolio:colony:<room>`
- Temporal basis: `game_tick`

The explicit positive generation makes both ID and Name unique when a room is
lost, reclaimed, or deliberately redeveloped. Future activation must prove the
generation is greater than retained history and has never been used; detached
string validation cannot make that stateful claim. The noun-phrase name follows
the canonical P3 naming guidance. The descriptive
Requirement title may use the imperative `Develop <room> to a Mature Operating
Base`; the P3 name may not inherit that verb-first form. Type, Sub-Type, parent,
name, Requirement Source, start tick, and source-controlled package revision are
immutable after future creation. A classification or source change requires a
governed successor rather than an in-place rewrite.

### Game-tick schedule adaptation

FSPM requires a Project to have a defined Start Date and End Date. World uses
the deterministic Screeps game clock and must not fabricate civil timestamps.
The candidate therefore requires explicit schedule-attestation inputs:

- `startTick` maps the planned Start Date;
- `initialDueTick` is the proposed initial End Date baseline; and
- six ordered Deliverable milestone ticks map the Room Development Plan first,
  followed by Bootstrap, Logistics, Core Economy, Advanced Operations, and
  Mature RCL8.

All values must be safe non-negative integers. The six milestones must be
strictly increasing in this order:

```text
attestedAtTick <= activationTick = canonicalAuthorizationTick <= startTick
  < Room Development Plan milestone
  < Bootstrap milestone
  < Logistics milestone
  < Core Economy milestone
  < Advanced Operations milestone
  < Mature RCL8 milestone = initialDueTick
```

Milestones are planned completion targets, never not-before gates. Evidence may
be captured and a Deliverable may be accepted early once Project work has
started and every quality and receipt condition is satisfied. Actual accepted
completion is recorded separately; schedule variance compares that actual tick
with the retained planned milestone.

The builder must not infer dates from discovery time, current controller level,
current room state, `Game.time`, or `Memory`.

`initialDueTick` is neither authorization nor evidence of actual closure. FSPM
permits a Project End Date estimate to change as work progresses, with revisions
logged. A future append-only schedule-revision ledger must preserve this initial
baseline, derive the current due and milestone ticks, and distinguish both from
the actual accepted closure tick. Revision 1 rejects in-place schedule mutation
because that ledger does not exist yet; it does not claim End Date is canonically
immutable.

### Deliverable decomposition and weights

The Project has exactly two root Corporate Deliverables. `Mature Base State`
has exactly five Child Result Deliverables and `Room Development Plan` has no
children. Decomposition stops there: Tasks, recurrence instances, and
grandchildren are forbidden.

| Deliverable | Type | Parent | Weight (basis points) |
| --- | --- | --- | ---: |
| Room Development Plan | Product | Project root | 1,000 |
| Mature Base State | Result | Project root | 1,000 |
| Bootstrap Base State | Result | Mature Base State | 1,200 |
| Logistics Base State | Result | Mature Base State | 1,200 |
| Core Economy Base State | Result | Mature Base State | 2,000 |
| Advanced Operations Base State | Result | Mature Base State | 1,600 |
| Mature RCL8 Base State | Result | Mature Base State | 2,000 |

These seven records form one flat Project weighting pool totaling exactly
10,000 basis points. Every record is counted once. Roots and children are not
independently normalized, child scores are not rolled into their parent and
then counted again, and missing or unavailable quality is never renormalized
away. This interpretation preserves the canonical rule that the current
Deliverable set for one P3 totals 100 percent without double counting the
hierarchy. The five children receive the remaining 8,000 points in the existing
room-development catalog's 15/15/25/20/25 proportion, preserving its relative
stage priority without creating a second weight pool.

This allocation is a source-controlled proposal, not an Accountable Position's
confirmation. Future activation must capture that confirmation explicitly; the
definition-package attestation and schedule attestation grant no weight
authority.

Each child carries the pinned Requirement Source and canonical Requirement
Verbiage: exact `§ Binding obligation` locator on the first line, then the
verbatim obligation. It also carries its own schedule milestone, an
independently measurable Quality Metric and Receipt Validation contract,
exactly one parent, and no child of its own. The five stage identities and
prerequisites align with the version-4 room-development stage catalog. RCL is
used only to determine eligibility. Every stage policy explicitly requires the
Room Development Plan Product to be currently accepted; its earlier planned
milestone expresses intended sequencing but does not create that dependency or
prevent an early stage acceptance.

### Product persistence

`Room Development Plan` is a Product because the validated RCL8 plan artifact
persists with the colony after delivery. Its evidence must identify the exact
plan version, horizon, geometry fingerprint, package binding, and validation
result. A later projection or maintenance action must not overwrite an accepted
Product artifact or its evidence. Continued repair and plan maintenance belong
to the Colony Portfolio after Project closure.

The room's mutable operational projection is not itself authoritative FSPM
history. A future receipt must bind the retained Product artifact in the
durable evidence store rather than treating the current `Memory` object as
immutable evidence.

Revision 1 deliberately names its evidence storage as unresolved and blocks
receipt capture. It also refuses to pass Product quality from a syntactically
valid hash or caller-supplied `current` flag. A future verifier must accept the
complete artifact bytes, recompute the artifact and projection fingerprints,
run the governed room-plan validators, and persist the immutable artifact in a
content-addressed append-only store before the Product can be received.

### Quality and receipt boundary

Blueprint realization is necessary but not sufficient for a Result. The
runtime has deterministic room-development primitives that can recompute exact
governed placements, but revision 1 does not bind or invoke them as an evidence
verifier. Its detached metric function reports only whether caller-supplied
fields are internally shape-consistent and always fails the overall result.
A future content-recomputing verifier must bind the exact room and accepted
plan artifact before placement evidence can be received. Even that proof could
not alone establish logistics throughput, operating services, defensive
readiness, independent receipt, or acceptance.

The final integrated `Mature Base State` may be accepted only when one evidence
bundle proves all four independent legs:

1. the accepted version-4 RCL8 blueprint and exact planned placements;
2. current and fresh operational evidence for every stage, including bootstrap
   recovery, source throughput, transport continuity, storage logistics, and
   advanced-service operation at governed thresholds;
3. every applicable mature capability is both authorized and operational; and
4. defensive geometry, reserves, fallback, and threat response satisfy the
   governed defense thresholds.

An RCL8 room with missing structures, unproven logistics, authorization debt,
an unavailable mature service, or defense debt fails this contract. Controller
level, construction sites, source-controlled code, prepared algorithms, and
self-asserted runtime health cannot substitute for captured evidence. The
evidence-capture principal and acceptance principal must remain distinct.

No receipt or acceptance record is created in this slice. Receipt storage,
operational evidence evaluators, and freshness thresholds are explicitly
unresolved blockers under #176. In particular, the current PTR room state must
not be used to invent historical stage completion.

The package names existing source symbols `MATURE_CAPABILITY_GATES` and
`assessPreparedActiveDefense` only as non-authorizing integration locators.
Symbol existence does not bind behavior. Future activation must content-bind
the mature-capability manifest and every quality evaluator contract to reviewed
versions so a later implementation change cannot silently reinterpret this
immutable definition.

### Task-or-Procedure determination

Every Deliverable requires a discrete unit of accountable work whose completion
can produce its output, so each has exactly one direct Task candidate:

| Deliverable | Direct Task candidate |
| --- | --- |
| Room Development Plan | Produce Room Development Plan |
| Mature Base State | Validate Mature Base State |
| Bootstrap Base State | Achieve Bootstrap Base State |
| Logistics Base State | Achieve Logistics Base State |
| Core Economy Base State | Achieve Core Economy Base State |
| Advanced Operations Base State | Achieve Advanced Operations Base State |
| Mature RCL8 Base State | Achieve Mature RCL8 Base State |

These are immutable candidate definitions, not canonical Task records. Each
specifies the future direct Task's complete 10,000-basis-point weight and at
least one non-executable Procedure candidate, but has no live Task ID, `Active`
status, timestamps, assignee, Activity history, or execution authority. A
later governed activation must materialize each Task explicitly. No Procedure
may bypass the Task or directly satisfy a Deliverable.

### Definition-only implementation boundary

The bounded implementation consists of a source-controlled policy, immutable
candidate package, pure constructor, strict validator, adversarial tests, and a
golden deterministic fixture. It is intentionally isolated from the live
colony-operations package and hot-loop governance validator.

It must not:

- read from or write to `Game`, `Memory`, or a live colony Portfolio;
- bump the Memory schema or backfill an existing colony;
- activate a Project, Requirement, Deliverable, or Task;
- issue game intents or grant a Procedure an intent allowlist;
- capture or decide a receipt;
- assert stage acceptance or Project completion; or
- contribute to Task QI, DQI, PQI, EQVM, or operational-health scoring.

Candidate validation proves only that a proposed, service-principal-attested
baseline schedule and definition are structurally eligible for review. It does
not authorize the Requirement or make the candidate live.

This slice also does not rewrite the existing live colony authority package,
whose Requirement Verbiage still lacks canonical first-line locators. That
versioned migration remains isolated under #203; conformance stays adapted
until it is complete.

### Accountability adaptation

The candidate package uses a source-controlled Screeps governance service
principal to identify its issuer and bind the policy hash. This preserves
deterministic provenance but does not satisfy canonical human accountability.
There is no human Employee, Position, OU, ARCI assignment, typed-name approval,
or human acceptance record. The package must describe the principal as a
service principal and never render its attestation as a human signature.

Issue #164 remains the authority gap. Project activation and lifecycle work
must not convert this disclosed adaptation into a silent full-parity claim.

## Rejected alternatives

### Treat World as a new P3 Type

Rejected. FSPM's P3 taxonomy is closed to Project, Program, and Portfolio.
World is a product/runtime mission label.

### Put temporary development directly in recurring colony services

Rejected. The endeavor has a unique bounded result and schedule. Ongoing
maintenance stays under the Colony Portfolio, but delivery of the initial
mature base satisfies the Project creation test.

### Use controller level as stage completion

Rejected. RCL unlocks eligibility but proves neither blueprint realization nor
operational quality.

### Normalize root and child weights separately

Rejected. Two independent 100-percent pools would double count one Project's
Deliverables and make a direct P3 roll-up ambiguous.

### Backfill evidence from the present room state

Rejected. Observation after the fact cannot establish who captured evidence,
which authorized revision governed the work, or who independently accepted it.

## Future lifecycle

A later, separately reviewed slice may create and persist the candidate only
after canonical authorization, complete OU/Position/ARCI assignments, current
ownership of the exact room, an active exact Colony Portfolio parent, and proof
that its generation is monotonic and unused. Publication must occur in the same
tick as canonical authorization, no earlier than the schedule attestation, and
no later than `startTick`, consistent with proactive Project creation.
Activities and evidence remain forbidden before `startTick`.

That lifecycle slice must add, in order:

1. a compact durable binding to the immutable package revision, initial
   schedule, and an append-only schedule-revision ledger;
2. canonical human/OU/ARCI authority or a still-explicit adaptation;
3. real direct Tasks and governed Procedures;
4. a content-addressed durable artifact store plus append-only Activity,
   evidence, receipt, and independent decision records;
5. content-bound mature-capability and quality-evaluator contracts followed by
   stage-gated activation that never rewrites earlier evidence;
6. an integrated mature-state decision; and
7. irreversible Project closure with the actual accepted closure tick while
   retaining the Product artifact and handing maintenance to the Colony
   Portfolio.

Until those controls exist, the Project candidate remains inert, quality
indices remain unavailable, and #176 remains open.
