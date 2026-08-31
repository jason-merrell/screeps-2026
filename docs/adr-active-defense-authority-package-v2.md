# ADR: Prepared active defense and authority-package v2 boundary

## Status

Proposed. Deterministic analysis is implemented; creep-combat execution is not
approved, cataloged, or live.

## Current authority boundary

The active package is exactly
`screeps-fspm-authority-package/v1` /
`authority-package:empire:colony-operations:v1`, revision 1. Its defense Task,
`maintain-defensive-readiness`, owns only these execution Procedures:

- `fund-tower-reserve` permits `transfer`;
- `repel-hostile` permits `towerAttack`.

It does not authorize spawning a defender as defense work, moving a creep for
combat, melee or ranged creep attack, healing a combatant, boosting, safe-mode
activation, or nuker operation. The exact open debt code is
`creep_combat_authority_unapproved`.

`packages/runtime/src/systems/defense/active-defense-readiness.ts` is therefore
pure decision-support evidence. It reads only values supplied by its caller,
returns no `Intent`, touches no Screeps global, and cannot change the Task or
Procedure catalog. It models body-order-sensitive boosted TOUGH, active boosted
combat output, adjacent/ranged healing pressure, exact tower falloff, current
geometry damage feasibility, tower and strategic-energy reserves, safe-mode
fallback evidence, and incoming-nuke protection gaps. Its ranking is explicitly
diagnostic. Safe mode is never counted as nuke mitigation.

The current runtime and Screeps Lab do not yet publish this prepared readiness
record and must not claim that its inputs are live evidence. A future adapter
must derive safe-mode evidence from the owned controller's exact `safeMode`,
`safeModeAvailable`, and `safeModeCooldown` values; derive incoming threats from
`FIND_NUKES` and compute blast geometry against the exact critical-asset and
rampart positions; and read storage, terminal, tower energy, capacity, body,
boost, hits, and positions from one fenced same-tick world snapshot. Reserve
targets must come from a separately identified policy, never caller-selected
values presented as observed facts. Before storage at RCL4 or terminal at RCL6,
the absent structure is not applicable rather than missing evidence.

Current-volley feasibility follows the server's pinned
[`tick.js` resolution order](https://github.com/screeps/engine/blob/80977824199a596d174d392fd0cf8c458c21fcbd/src/processor/intents/creeps/tick.js#L118-L135):
accumulated damage is applied, accumulated healing is then applied, and only
then is death resolved. Damage reaching current hits before healing is exposed
separately and is never labeled a kill when queued healing leaves positive
resolved hits. The shared falloff, ordered-TOUGH, and healing primitives are
also used by the live tower-only planner so the prepared analysis cannot drift
behind its authorized subset.

No dormant combat intent or executor type is added in this revision. Adding an
executable-looking operation before a governed Procedure exists would enlarge
the attack surface without delivering authorized capability.

## Required v2 supersession

Active creep defense requires a reviewed replacement package, not an in-place
edit of v1. The minimum supersession must do all of the following as one
content-pinned change-control transaction:

1. Implement the currently missing package-supersession mechanism. Preserve
   v1 Requirement, Deliverable, Task, Procedure, Activity, receipt, decision,
   and lifecycle history; append retirement/supersession evidence; never
   rewrite or reactivate v1 records.
2. Introduce the exact schema and identity
   `screeps-fspm-authority-package/v2` /
   `authority-package:empire:colony-operations:v2`, revision 2, with a new
   effective date, accountable OU/Position/service-principal attestation,
   governance SHA, canonical content hash, and signed-content hash. Merely
   changing these strings or resigning locally is not approval.
3. Add a separately determined defense Task (provisional key
   `provide-active-creep-defense`) under the defense Deliverable. The review
   must approve its independently measurable output, compound/atomic
   determination, KPI rubric, Activity boundary, receipt evidence, and complete
   Task-weight reallocation. Existing active Tasks under that Deliverable and
   the new Task must total exactly 10,000 basis points.
4. Approve the smallest complete Procedure set needed for that Task. At
   minimum, the review must explicitly decide authority for defender staffing,
   combat movement, melee/ranged engagement, healing/support, retreat/recycle,
   and target reacquisition. Lab boosting, safe-mode activation, inter-room
   response, and nuker launch remain separate unavailable capabilities unless
   they are named, scoped, and reviewed in the same package.
5. Only after steps 1–4, add narrowly typed intent operations and executors.
   Every combat intent must bind the exact v2 P3 → Requirement → Deliverable →
   Task → Procedure chain, owned same-room actor, currently hostile concrete
   target, allowed operation, work key, and Activity. Unknown owners, neutral or
   allied creeps, missing objects, stale visibility, cross-room scope, retired
   ancestry, wrong Procedure, and v1 traces must fail closed.
6. Keep analysis and execution separate. Prepared rankings may propose
   evidence, but the production authorizer must re-resolve actor, target,
   hostility, scope, ancestry, and exact operation from the same tick-local v2
   authority snapshot before arbitration and again before Activity binding.
7. Add versioned Memory migration and rollback behavior. A failed or partial v2
   activation must leave v1 history intact, execute zero new combat work, and
   emit bounded structured denial/debt evidence rather than repairing authority.

Until that complete package is reviewed and activated, the runtime must expose
`creep_combat_authority_unapproved`, and mature defense operational health may
be capped by `preparedDefenseOperationalHealthCap`. The cap is operational
telemetry only; it cannot become an Activity KPI, Task QI, DQI, or PQI.

## Issue-ready acceptance criteria

- [ ] A governance decision approves the exact active-defense Task output,
      determination, Procedures, operation scope, weights, KPI rubric, and
      accountable acceptance path; the approved immutable source is cited.
- [ ] v2 package schema, ID, revision, governance SHA, effective date,
      attestation, and content hashes are pinned and adversarially validated.
- [ ] A deterministic supersession transaction preserves all v1 evidence and
      rejects partial activation, in-place mutation, reactivation, downgrade,
      mixed v1/v2 ancestry, and same-tick replacement.
- [ ] The current v1 runtime continues to expose
      `creep_combat_authority_unapproved` and contains no creep-combat intent or
      executor path.
- [ ] Body construction observes the room energy budget, replacement lead time,
      strategic reserve floor, boost availability, movement terrain, and the
      assessed hostile body without spending reserved recovery energy.
- [ ] Targeting regression fixtures cover front- and rear-loaded boosted TOUGH,
      destroyed parts, boosted melee/ranged/WORK/heal output, multiple healers,
      tower range 0–49, insufficient tower energy, edge movement, target loss,
      and deterministic tie-breaking.
- [ ] Production authorization rejects missing/unowned actors, neutral/allied or
      stale targets, wrong room/P3, remote scope, invalid operation/Procedure,
      malformed body evidence, retired ancestry, forged trace IDs, and all v1
      combat-shaped requests with zero side effects.
- [ ] Execution supports success and every relevant engine failure code without
      fabricating productive work, completion, receipt, KPI, or acceptance.
- [ ] Safe-mode state and incoming nukes are observable evidence. Safe mode is
      never represented as nuke protection; unprotected critical blast
      positions remain explicit operational debt.
- [ ] The live evidence adapter pins controller `safeMode`,
      `safeModeAvailable`, and `safeModeCooldown`; `FIND_NUKES` blast geometry;
      exact structure stores; exact body order/boost/hits; and the identified
      reserve policy from one same-tick snapshot. RCL-locked storage/terminal
      inputs are marked not applicable, while unlocked-but-unseen inputs fail
      closed. Runtime and Lab display the capture tick and input provenance.
- [ ] Replay, typecheck, lint, unit, full runtime, production-main, and exact-SHA
      tests pass, including a zero-combat-side-effect v1 control fixture and a
      hostile/neutral/ally adversarial matrix for v2.

## Non-claims

This preparation does not prove that a defender can be spawned, moved, boosted,
or commanded; that a hostile can be defeated over future ticks; or that a nuke
can be survived. Tower feasibility is a conservative current-geometry signal,
not a future-state combat simulation or authority grant.
