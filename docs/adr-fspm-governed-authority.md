# ADR: Governed Corporate Requirement and Deliverable authority

## Status

Accepted for the source-controlled Screeps authority-package adaptation.

## Governance authority

This decision was reviewed against `Namauu/governance-docs` at commit `02d581886a759d19044ff91a80d743fa042f23f7`, especially:

- `execution/data/corporate-requirements.md` §§4, 5, 7, 8.1–8.3;
- `execution/data/corporate-deliverables.md` §§2, 4–6;
- `execution/data/tasks.md` §§5–7 and 9;
- `structure/eqvm.md` §§6.7 and 6.12–6.14; and
- `execution/processes/deliverable-creation-process.md` Stages B–F.

## Problem

The previous trace helper created active, generic Requirement and Deliverable records when a planner first requested work. That inverted authority: demand manufactured the obligation that supposedly authorized the demand. The records lacked the canonical requirement source, approval evidence, organizational applicability, Deliverable semantics, receipt contract, and exact sibling weights. They were useful trace scaffolding but could not be treated as approved FSPM authority.

## Decision

The runtime accepts current work only beneath a complete, versioned authority package. The initial package is a code-shipped projection of [Screeps Colony Operations Policy](./screeps-colony-operations-policy.md). It names its schema, revision, governance SHA, issuer, effective date, accountable OU/Position/principal adaptation, exact content hash, and typed package attestation.

Package activation is an explicit mandatory phase between perception and planning. It validates the entire package, builds all four Requirements, all four Deliverables, the complete weighted Task/Procedure catalog, adapted activation events, and package activation receipt in temporary objects, validates the result, and only then publishes the portfolio. An invalid package, malformed root P3, or existing unquarantined spine produces no partial Memory mutation. Subsequent ticks validate and reuse the exact binding; they do not rewrite it.

Intent tracing is read-only for the complete P3 → Requirement → Deliverable → Task → Procedure authority spine. Missing authority throws before planner mutation. The execution snapshot independently validates the same package and ancestry and therefore denies stale, inactive, malformed, unsigned, edited, wrong-OU, weight-invalid, or relationship-invalid authority.

## Corporate Requirements

Each Requirement contains the canonical content fields and exactly one origin path. The initial policy records are derived, so `requirementSource` names the immutable policy and `originatingAuthority` is absent. Both or neither is invalid; a future Regulatory/Compliance record must also be derived.

The autonomous-system adaptation records an append-only activation event in the Requirement approval-shaped ledger. It binds Requirement ID and revision, the hash of the exact approved content, applicable OU, derived Department authority OU, accountable Position, service-principal signer, typed policy attestation, date, package identity/revision/hash, and the exact game tick of package import. The Requirement’s approval-shaped fields are validated projections of that event. Approved content, identity, ancestry, activation identity, package binding, creation tick, and import tick are mutation-guarded and hash-checked. This is not a human approval event. This revision deliberately exposes no in-place correction API; replacement through a later governed package revision remains required work rather than an implemented supersession claim.

## Corporate Deliverables and receipts

Each Deliverable names its exact P3 and Requirement parent, category, product/service/result type, details, output, the Requirement's authoritative policy source and verbiage, primary priority plus all five evaluation narratives, Quality Description, Quality Metric, three-part Receipt Validation contract, integer sibling weight, and explicit parent/child relationship fields. Authority package v1 permits only root Deliverables and rejects non-empty child sets; general one-level decomposition remains issue #176 rather than being implied by empty arrays.

The Receipt Validation contract is not a receipt. Actual receipts are separate append-only, hash-chained instances bound to the Deliverable ID, revision, and approved-content hash. The current recorder accepts only a real completed Activity belonging to a Task under that Deliverable, derives the evidence reference from its terminal chronology, Quality Metric, and KPI, and records the outcome as `received`. The Activity must have begun no earlier than package import and retain monotonic creation, start, completion, and update ticks.

Each receipt retains a compact immutable completion snapshot: source Activity and Task identity, all four lifecycle ticks, terminal KPI, exact Quality Metric, evidence reference, and content hash. The live Activity registry therefore remains bounded and may prune the original Activity without invalidating durable receipt evidence. Registry validation proves storage identity, contiguous per-Deliverable sequence, monotonic capture time, previous-hash linkage, unique use of each Activity, package-import chronology, the package Task's exact Quality Metric, and the complete Receipt Validation contract. Arbitrary reference strings, duplicate or cross-Deliverable Activities, backdated entries, and edited snapshots or chains fail closed.

`received` means system evidence was captured; it is not accountable acceptance. A second global append-only decision ledger records exactly one terminal `accepted`, `rejected`, or `disputed` decision per receipt. Every decision binds the immutable receipt hash, Deliverable ID/revision/content hash, package ID/revision/hash, accountable service principal, reason, tick, and previous decision hash. Decision time cannot predate evidence capture or regress across the chain, and a terminal decision cannot be replayed or overwritten. The package-bound acceptance predicate permits `accepted` only for terminal `satisfactory` or `exceptional` Activity KPI evidence; `unsatisfactory` evidence may be rejected or disputed but cannot be caller-promoted to accepted.

Receipt capture and receipt decision are explicit, separately atomic authority mutations. An undecided receipt is therefore a valid intermediate state. The production loop does not invoke either mutation: this revision does not automatically convert terminal Activities into Deliverable receipts or decisions. Their existence proves validation and mutation semantics, not completeness of live occurrence evidence.

Receipt and decision ledgers are retained entirely in runtime Memory. No bounded checkpoint/archive, durable collector acknowledgment, safe compaction protocol, or archive gap detector is implemented. Automatic reconciliation must remain disabled until #194 supplies those controls; a per-tick rate limit alone would not bound lifetime Memory or validation cost and could allow Activity evidence to be pruned before capture.

All four v1 Deliverables are recurring services. A valid accepted decision closes one service occurrence; it does not complete the durable service definition. Accepted, rejected, and disputed occurrences all leave the definition Active. This revision exposes no service-completion operation because v1 has no separately approved closure criterion covering the required period or Task-weight set. Governed service closure/supersession remains explicit future work. The decision is an autonomous-system adaptation performed by the package-bound Screeps accountable service principal, not a claim of canonical human acceptance. Human Accountable acceptance remains #164, while DQI/PQI evidence remains #136; neither is fabricated from successful intents or room-health signals.

Receipt, receipt-decision, and lifecycle registries each carry a chain-independent retained-entry count and deterministic content digest. Validators recompute those anchors on every authority check, so deleting the newest chain suffix fails closed just as interior deletion or editing does. The anchors are tamper evidence, not a secret or external signature; a sufficiently privileged Memory writer can still rewrite both data and hashes.

## Retirement evidence

Requirement and Deliverable retirement is an explicit, irreversible runtime adaptation. A deterministic batch operation first validates the complete executable package, then writes one or more globally sequenced, previous-hash-linked lifecycle events, its updated ledger anchor, and the matching retired record projections as a single portfolio replacement. Every event binds record kind, revision, approved-content hash, reason, accountable service principal, tick, and authority package. Retired records without events, edited or shortened chains, duplicate retirement, or reactivation after Memory reload fail validation. Any retirement deliberately blocks the current package until a separately reviewed superseding revision restores a complete, exactly weighted authority set; supersession itself remains unimplemented.

## Exact weights

All weights are validated as integer basis points. Current Deliverables under a colony P3 total exactly 10,000. Active Tasks under each Deliverable total exactly 10,000 (the existing percentage catalog is converted to basis points for validation). The initial package activates both sibling sets atomically. Retirement that leaves a current set below 10,000 fails closed until a governed superseding package reweights the full set.

## Migration

Memory v8 does not bless any v7 record. It moves the complete pre-v8 Requirement, Deliverable, Task, Activity, quality, and KPI spine into an explicit historical quarantine, clears live authority, activation, receipt-evidence, receipt-decision, and lifecycle registries, initializes empty ledger anchors, and leaves the governance binding absent. The approved package may then activate through the ordinary top-down import phase. Given identical input Memory and tick, quarantine output is deterministic.

## Hash and assurance posture

Canonical, key-sorted JSON plus a dependency-free SHA-256 implementation makes package, approved-content, activation, receipt, acceptance-decision, lifecycle, and retained-ledger-anchor drift evident and replayable inside the Screeps VM. Hashes complement—not replace—runtime authorization and source-control review. A sufficiently privileged operator can still rewrite Memory and recompute hashes; repository review, deployment provenance, and platform audit logs remain the control for that threat.

## Explicit adaptation boundary

The Corporate Requirement schema requires a human Employee holding an Accountable Position for the derived Department OU, or the CEO exception. The current runtime has no governed human Employee/Position registry. Its named source-controlled service principal and `source_control_policy_attestation` are an explicit autonomous-system adaptation and are never labeled a human signature. Human OU/ARCI parity remains issue #164.

Deliverable lifecycle is also an explicit runtime adaptation: the canonical Deliverable schema does not define the runtime's `active|retired` projection. Complete Activity weighting, DQI/PQI, human reviewer/dispute handling, governed recurring-service closure, live occurrence reconciliation, bounded receipt archival, and the unresolved canonical KPI scale remain incomplete. Those limitations remain visible in the machine-readable conformance profile and issues #136, #164, and #194.
