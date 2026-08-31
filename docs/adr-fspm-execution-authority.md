# ADR: Fail-closed FSPM execution authority

## Status

Accepted for the runtime authority-invariant slice.

## Authoritative governance source

This decision was reviewed against `Namauu/governance-docs` at commit
`02d581886a759d19044ff91a80d743fa042f23f7`, specifically:

- `execution/data/p3.md`
- `execution/data/tasks.md`
- `execution/data/activities.md`

The normative FSPM rules used here are that every unit of managed work attaches to a P3; every Task has exactly one parent Deliverable and inherits that Deliverable's requirement source; a Procedure is owned by its Task and has no independent existence; only an Active Task is in the live set and generates Activities; a Retired Task generates no new Activities; and every Activity instantiates exactly one Task.

Requirement and Deliverable lifecycle enums in the Screeps runtime are an adapted implementation model. The governance documents above establish the required traceability spine, but they do not define the runtime's game-tick status representation for those two record types. This ADR therefore does not claim complete FSPM schema or ARCI parity.

## Problem

An intent trace previously needed only a `taskId` that happened to exist in one colony portfolio before Activity binding. The runtime did not prove that the trace's P3, Requirement, Deliverable, Task, and Procedure described the same active ancestry. Consequently, a stale or adversarial trace could execute and open or resume an Activity under a Retired Task, an inactive ancestor, a foreign parent, or a Procedure belonging to another Task.

Compatibility repair also risked hiding contradictory authority. A missing legacy parent link may be migrated deterministically, but an existing conflicting link must not be rewritten merely because a planner requests work.

## Decision

Current execution authority exists only when one unique, exact, active chain resolves:

```text
active root Empire OU Portfolio
  -> active colony OU Portfolio/P3
  -> active Requirement whose p3Id is that colony Portfolio
  -> active Deliverable whose requirementId is that Requirement
  -> exact active catalog Task identity whose deliverableId is that Deliverable
  -> exact catalog Procedure ID/key owned by that Task
  -> intent operation explicitly allowed by that Procedure
```

The Requirement, Deliverable, and Task domains must also agree with their canonical in-memory registry positions. A current trace must carry `p3Id`; a historical `contractId` is decoder evidence only and cannot authorize execution.

Authority resolution is read-only and deterministic. Missing, duplicate, inactive, non-catalog, operation-incompatible, or mismatched records return a stable denial code. A single tick-local authority snapshot indexes the complete hierarchy once and is reused for both proposal authorization and Activity binding; the cost is therefore `O(hierarchy + intents)`, not a hierarchy or Procedure scan per intent. The index stores exact Procedure positions as well as identity maps, and an Active catalog Task must contain the complete catalog Procedure set before it can enter the view. Activity binding validates the full intent again against that same indexed authority view as defense in depth, so direct or stale callers cannot create, reassign, advance, or resume an Activity through an invalid chain.

Authorization returns both accepted intents and structured denial evidence. Denials are counted exactly by stable code, while payload samples are capped at 24 and published in canonical tick observability. Denied intents never reach arbitration, binding, or execution.

Current catalog Tasks are colony-local. Authorization therefore also proves execution scope for every intent operation: a creep actor, spawn/tower executor, construction room, and concrete target must resolve to the same owned colony named by the P3. Missing objects and cross-room work fail closed. Remote execution is not inferred from trace ancestry and remains unavailable until a separate governed remote-scope authority is defined.

The mandatory `fspm_governance` phase validates and atomically activates the exact source-controlled authority package before any planner runs. It materializes the complete approved Requirement-to-Procedure catalog in one top-down transaction; planner and trace paths cannot add records. Planning authority then performs one global identity-registry preflight, builds a tick-local index and live-reference witnesses, and installs non-serialized mutation-aware guards over every authority identity, canonical registry slot, adapted activation event, receipt, receipt decision, retirement event, and Procedure collection. Later trace requests resolve their requested Empire-to-Procedure spine through constant indexed lookups only. A raw same-tick change anywhere in the indexed hierarchy invalidates the transaction; a global rebuild exposes malformed or ambiguous identity, while a semantically canonical replacement is still rejected as out-of-band mutation. Canonical registry topology is closed for the rest of the tick, then restored to equivalent extensible plain objects once at tick rollover before perception can discover colonies.

Colony storage keys, P3, Requirement, Deliverable, Task, and Procedure identities and placements must be canonical and globally unambiguous. Package activation rejects a missing, malformed, noncanonical, or inactive Empire/colony root before publishing any projection. A malformed existing authority container is preserved for diagnosis, but cannot create traces or authorize execution; authority is never fabricated as a repair. Only versioned migration may add the P3 to a legacy pre-P3 colony portfolio. Tick snapshots reject cross-tick reuse and same-tick hierarchy removal or replacement rather than authorizing through detached references. Governed Requirement/Deliverable retirement persists an irreversible hash-chained lifecycle event; reactivation after serialization remains invalid.

The invariant fails closed. Denial does not guess a replacement parent, reactivate a record, rewrite Activity identity, or synthesize completion/KPI evidence. Existing nonterminal Activities remain historical/current lifecycle records for a separately governed resolution policy; this slice only prevents invalid authority from causing additional execution transitions.

## Compatibility boundary

Memory v8 quarantines the complete pre-package Requirement, Deliverable, Task, Activity, quality, and KPI spine without promoting any placeholder into authority. The current package may then activate only through the ordinary validated transaction. Planner trace creation is read-only: unknown catalog Task/Procedure keys, incomplete Active catalog Procedure sets, inactive existing ancestors, and contradictory Portfolio, Requirement, Deliverable, Task, or Procedure identities throw without changing Memory. A Retired Task record, including its definition fields and Procedure history, is never canonicalized or appended. Legacy Service Program and synthetic contract records remain readable historical evidence but never substitute for the active P3 chain.

## Enforcement evidence

`packages/runtime/test/planning/fspm-execution-authority.test.ts` pins the governance SHA and adversarially verifies:

- the legitimate canonical chain authorizes execution and opens an Activity;
- a Retired Task cannot create or resume an Activity and is not silently reactivated;
- inactive Empire P3, colony P3, Requirement, and Deliverable ancestors fail closed;
- missing P3, Requirement, Deliverable, and Task ancestors fail closed;
- mismatched P3, Requirement, Deliverable, Task, and Procedure parentage fails closed without repair;
- unknown or mutated Task identity, forged or duplicate Procedure identity, and a legitimate Procedure used for the wrong intent operation fail closed;
- trace-missing denials remain visible and cannot bind Activity evidence;
- planner trace creation under inactive or contradictory ancestry and unknown catalog keys is deep-equal read-only, and Retired Task history is immutable;
- one indexed snapshot is reused across a many-intent authorization and binding fixture;
- exact denial counts, bounded samples, and canonical observability publication are verified;
- cross-room or missing creep actors/targets, spawn executors, construction rooms, towers, and hostile targets fail closed, while a same-room owned tower path remains valid;
- wrong-key and cross-colony registry identities are rejected globally with deep-equality zero-mutation proof;
- 256 fresh trace requests perform one global registry traversal, while tick rollover performs exactly one new traversal;
- same-tick Empire, colony, Requirement, Task, and Procedure replacement or mutation is rejected before planner mutation, including an in-place identity mutation in a non-requested colony;
- exact Procedure-position indexes eliminate per-intent Procedure scans, and an Active Task with an extra, missing, reordered, or non-catalog Procedure set fails global preflight;
- stale snapshots reject cross-tick reuse and same-tick hierarchy replacement/removal;
- malformed Empire and colony containers survive production maintenance for quarantine but cannot implicitly become active authority;
- a legacy contract-only trace remains decodable but cannot authorize current work.

The native production-main gate independently proves both malformed-root boundaries for 12 engine ticks. Every post-activation Segment 99 publication must be fresh, strictly increasing, correlated to `lastPublication`, built from the exact candidate SHA, and carry bounded `empire_p3_missing` or `colony_p3_missing` evidence. Both modes require zero authorized work, zero fabricated Activity evidence, zero engine side effects, and continued authority/arbitration/execution completion after the contained governance-activation and maintenance failures. Deferrable settlement or construction may be skipped only with the supervisor's explicit cadence/admission reason; a skip is never accepted as an unqualified success.

## Out of scope

This slice does not invent the complete OU or ARCI schema, scheduled Activity dates, cancellation/migration policy for already-open work, or complete lifecycle parity. Those remain governed separately.
