# ADR: Evidence-complete EQVM quality roll-up

Status: Formula implementation verified; recurring Activity-weight policy unapproved
Governance baseline: `Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`
Canonical source: `structure/eqvm.md`, especially §§6.9–6.14, 7.2, 10, 11.2–11.3, and 12.1–12.2

## Decision

Room readiness, workforce coverage, development realization, tower reserve, and current execution risk are **operational health**. They remain useful diagnostics, but they are not an Activity KPI, Task QI, DQI, or PQI and cannot earn FSPM quality credit.

Canonical runtime quality may follow only this evidence chain once its concrete
Activity-weight policy receives accountable approval:

`verified terminal Activity KPI -> Task QI -> Task-Weight-adjusted DQI -> Deliverable-Weight-adjusted P3/PQI`

The formulas are the governance formulas without renormalization around missing evidence:

```text
Task QI = Sum(Activity Weight x Activity KPI Rating) / Sum(Activity Weights)
DQI     = Sum(Task Weight x verified Task QI) / Sum(Task Weights)
P3/PQI  = Sum(Deliverable Weight x DQI) / Sum(Deliverable Weights)
```

Task weights total exactly 10,000 basis points within each Deliverable. Deliverable weights total exactly 10,000 basis points within the colony P3. A bad weight sum is `invalid`, never silently normalized.

## Unapproved Activity-weight research configuration

Recurring Screeps Activity instances do not exist when a durable Task definition is approved, so static per-instance weights cannot be named in advance. The currently approved Task catalog contains no accountable approval for a concrete recurring-Activity weighting or reporting-period policy. The runtime therefore keeps this configuration outside governed Task records for research diagnostics only:

- policy ID: `eqvm:activity-weight:equal-terminal-samples:v1`;
- evidence scope: terminal Activity KPI samples only;
- cohort: latest 24 terminal Activities for the Task inside a 1,500-tick evidence window;
- weight: one equal unit per cohort Activity, normalized by dividing by the sum of units;
- framework reference: the governance commit above;
- authorization status: `unapproved`, with explicit accountable-approval debt.

This configuration demonstrates the FSPM formula but is not canonical Task quality. The governance guide does not mandate equal weights, and an AI-authored implementation cannot approve management policy. Its numeric result is segregated in `eqvmResearchTelemetry`; canonical `Task.qi.score` remains `null` with `activity_weight_policy_unapproved`. DQI and P3/PQI consequently remain unavailable.

## Evidence integrity

A sample can enter the non-authoritative research estimate only when it cross-verifies against its terminal Activity record:

- Activity ID and canonical Task ID;
- Activity type / Task key and assignee / actor;
- completed status and identical completion tick;
- terminal rating and exact FSPM multiplier;
- non-empty rating reason/evidence;
- identical evidence and KPI rating on the Activity record;
- the configured Activity-weight research policy ID.

Duplicate, extra, cross-Task, wrong-actor, wrong-type, future, or otherwise unverifiable samples make research coverage `invalid`. A fresh terminal Activity with no sample makes it `partial`. Stale evidence is `stale`. No terminal KPI evidence is `unavailable`. Regardless of research coverage, canonical Task QI remains unavailable until approval.

The multiplier scale represented by the calculator is exceptional `1.50`, satisfactory `1.00`, marginal `0.75`, unsatisfactory `0.50`, and rejected/non-compliant `0.00`. `in_progress` has no multiplier and can never earn quality. A verified zero is therefore materially different from unavailable (`null`).

## Fail-closed roll-up

Every canonical Task, DQI, and P3/PQI record carries the Activity-weight policy
ID, a coverage status, and a discriminated policy-authorization record. An
unapproved record carries non-empty authorization debt. An approved record must
instead retain its approval-event ID, approval-authority OU, accountable
position, signer principal, approval tick, and exact policy-content hash. A
naked `approved` string is not sufficient provenance. These approved fields are
only a forward-compatible structural shape: the current authority package has
no governed EQVM policy-approval ledger. Runtime reconciliation, trace
compaction, both publishers, and the Lab therefore reject every nested
approval-shaped claim. A future numeric path must resolve the event against an
immutable ledger and bind the exact policy, authority, signer, effective tick,
and complete rated Activity cohort; it may not trust the fields on the QI
payload itself.

The coverage statuses are:

- `complete`: all governed weight is covered by verified current evidence;
- `partial`: some governed evidence or weight is missing;
- `unavailable`: no qualifying evidence exists;
- `stale`: retained evidence falls outside the window;
- `invalid`: evidence identity, policy, score, or weights fail validation.

Task QI, DQI, and P3/PQI expose a numeric multiplier only when coverage is
`complete` **and** that exact policy has approval resolved from the governed
ledger. Because that ledger does not yet exist, the live numeric path is closed.
An
unapproved Task cannot become roll-up evidence even if malformed memory claims
`complete` with a numeric score; formula consumers withhold it and trace/export
boundaries reject both that contradiction and a fabricated approval-shaped
object containing the public policy hash. The current unapproved Activity-weight
policy and missing approval ledger make canonical Task QI unavailable, so
current DQI/PQI are null.
Missing Task QI cannot be dropped from the denominator. Missing DQI cannot be
dropped from P3/PQI. This prevents a single healthy lane or a research estimate
from producing synthetic quality.

Current failing execution remains visible without fabricating a KPI: prolonged zero-productivity, repeated retargeting, or blocked `In Progress` work caps the separate operational-health signal and records why. Only terminal Activity evidence can change EQVM.

## Authority and migration

QI, DQI, PQI, coverage, research telemetry, and operational health do not create or modify P3, Requirement, Deliverable, Task, Procedure, approval, receipt, decision, or retirement authority. Memory v10 discards the pre-v10 synthetic `quality` history and unverified KPI samples rather than promoting them. It does not stamp the research policy onto Tasks. The literal production-v8 upgrade regression proves governed Task authority remains byte-stable and execution-eligible. All append-only receipt/decision/lifecycle ledgers remain intact.

## Known framework limitations

- Canonical human Accountable review, reviewer identity, rating approval/dispute workflow, and ARCI remain issue #164. Runtime verification is the disclosed service-principal adaptation.
- Accountable management has not approved the recurring Activity weights, cohort length, or freshness window. Therefore canonical Task QI, DQI, and PQI remain unavailable; `eqvmResearchTelemetry` is explicitly non-authoritative.
- No governed EQVM policy-approval ledger/resolver exists. Self-asserted approval-event, authority, signer, tick, and policy-hash fields are rejected even when structurally well formed.
- The governance guide names PQI as project/program reporting. Applying the same exact weighted formula to the current continuously managed OU Portfolio P3 is a disclosed Portfolio roll-up adaptation.
- Runtime Activity/KPI history is bounded and still lacks durable collector acknowledgment and gap recovery. This prevents a claim of lossless, audit-complete EQVM history.
- EV, BAC, AC, EQV/QAEV, CPI/SPI, CQI/SQI, and Quality Variance are not fabricated because the current Screeps authority package has no approved financial/EVM baseline.

These limitations keep the overall FSPM profile partial. The formulas and fail-closed coverage behavior are implemented, but canonical EQVM quality is intentionally withheld until the missing management policy is approved and resolved from a governed ledger that predates the complete rated Activity cohort.
