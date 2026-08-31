# Room planning

Room construction follows a durable desired-state model:

> Plan the complete outcome, realize it in governed stages, and replan only from explicit evidence.

The `RoomPlan` itself is a mutable, non-authoritative operational projection. It may be regenerated as room evidence changes and is linked to the construction Deliverable only for execution traceability. Authoritative FSPM requirements, deliverables, Activities, receipts, and accountable decisions remain in the governed Portfolio records and append-only authority ledgers; a room-plan replacement does not overwrite or impersonate those records.

## Responsibilities

- **Settlement planning** owns the deterministic RCL8 desired state and its defensive envelope.
- **Development evaluation** compares exact planned coordinates with realized owned structures and identifies the active stage, blockers, and next milestone.
- **Construction planning** decides which eligible planned structure should become a construction site now.
- **Economy/workforce systems** allocate energy and worker effort to construction and maintenance.
- **Execution** remains the only layer that mutates `Game.*`.

## Version 4 RCL8 horizon

Room plan version 4 describes the complete legal owned-room footprint through RCL8. It does not treat an RCL3 bootstrap plan as a mature outcome.

The plan carries five ordered development stages:

| Stage | Unlock | Weight | Outcome |
| --- | ---: | ---: | --- |
| Bootstrap Base | RCL1 | 15 | Founding spawn, initial capacity, and first-response defense |
| Logistics Base | RCL2 | 15 | Source buffering and durable transport foundations |
| Core Economy Base | RCL4 | 25 | Storage-centered logistics, capacity growth, links, and stronger defense |
| Advanced Operations Base | RCL6 | 20 | Terminal logistics, minerals, labs, and redundant spawning |
| Mature RCL8 Base | RCL8 | 25 | Complete strategic structure inventory and defensive envelope |

These are runtime development stages and evidence boundaries. They adapt the colony's governed construction outcome; they do not invent additional canonical FSPM entity types.

At full horizon the plan includes the legal maximum of 60 extensions, 6 towers, 3 spawns, 6 links, and 10 labs, plus storage, terminal, extractor, factory, observer, power spawn, and nuker. The lab stamp guarantees every output lab is in reaction range of both input labs.

## Deterministic geometry and migration

Planning is intentionally conservative about already-governed geometry:

- a persisted version 3 footprint is upgraded without moving or renaming its planned structures or roads;
- compatible built structures and construction sites are adopted before empty candidate tiles;
- terrain walls, exits, sources, controller, mineral rules, reservations, roads, and incompatible occupants are excluded;
- structure counts are validated against every intermediate RCL, not only RCL8;
- duplicate identities, illegal overlaps, invalid lab geometry, or unrepresentable live mature structures fail closed;
- identical room evidence produces identical plan geometry.

Regeneration occurs when the plan is missing, its schema version or horizon is stale, or it is explicitly invalidated. Ordinary RCL changes do not relocate a valid plan.

### Operational projection epochs

Every RoomPlan carries three non-authoritative identity fields:

- `plannerRevision` identifies the code-owned planner/layout/defense algorithm revision;
- `projectionRevision` advances monotonically on every successful replacement, including a replacement with unchanged geometry; and
- `projectionFingerprint` deterministically identifies material projection content while excluding generation timestamps, invalidation annotations, and FSPM trace-link identifiers.

Memory v9 seeds revision 1 and a fingerprint only for projections crossing the explicit pre-epoch v8 migration boundary. A current-schema projection with missing, malformed, or content-inconsistent epoch metadata is regenerated; it is never silently re-fingerprinted in place. A self-consistent projection from an older planner revision is also regenerated. The fingerprint is a compact operational comparison aid, not governance evidence or an authority-ledger mechanism. `deliverableId` remains a separate trace link to the authoritative construction Deliverable.

Settlement generation failures are isolated per room. The last projection remains available while one bounded fault record captures the first and latest failed attempt, attempt count, retained epoch, concise remediation, and an exponential retry delay from 5 to 320 ticks. Skipped ticks do not inflate the attempt count. A successful replacement marks that fault as superseded by the exact new planner revision, projection revision, and fingerprint; no FSPM history is rewritten.

## Governed realization

Each stage-required planned structure has a stage, strategic weight, minimum RCL, priority, and exact `(type, x, y)` identity. Nearby or same-type substitutes do not count as realized evidence.

Construction may advance only controller-eligible work whose stage prerequisites are satisfied. Within that boundary, strategic weight and priority make the next site deterministic. The planner also respects the room and global construction-site budgets, existing sites, incompatible occupancy, and per-tick creation limits.

Activation modes remain explicit:

- `automatic` is eligible when its governed stage is active;
- `demand` requires demonstrated logistics or transport readiness;
- `defense` requires an RCL4+ defensive workforce/tower baseline or an active threat.

This keeps the full ambition visible from the start without spending bootstrap energy on infrastructure the colony cannot yet service.

## Roads

Roads are planned as a graph rather than independent spawn-to-target paths. Previously planned road tiles receive the cheapest route cost while subsequent edges are searched, encouraging shared trunks and route merging. The graph remains demand-gated so transport readiness can activate it without changing governed geometry.

## Defense

Version 4 replaces `pending-mincut` with a deterministic terrain-graph minimum vertex cut. The planner first forms one connected, walkable core footprint with at least three tiles of depth around critical core assets, then separates that footprint from every room exit. Remote source/controller logistics, distant service links, and the mineral extractor remain service outposts outside the main shell instead of inflating its permanent repair burden.

The resulting `terrain-mincut-v1` perimeter is capped at 96 ramparts (480 million RCL8 target hits). Natural objects and hostile or unowned occupancy are uncuttable; an empty, oversized, disconnected, unserviceable, or otherwise unrealizable cut fails room-plan publication. Planned roads that cross the shell are retained under own ramparts as explicit service gates, preserving colony-creep traversal without opening the barrier to hostile creeps.

The perimeter is footprint evidence, not decorative geometry. Defensive health measures:

- legal tower coverage for the current RCL;
- tower energy reserve;
- exact planned perimeter coverage; and
- rampart condition against an RCL-scaled target.

The peacetime rampart target rises from 10,000 hits at RCL3 through 50,000 at RCL4, 250,000 at RCL5, 750,000 at RCL6, and 2,000,000 at RCL7 to 5,000,000 at RCL8. It doubles during an active threat. A quiet room with one tower and no perimeter therefore cannot report perfect defensive health.

## Maintenance

Builders maintain roads and containers from a 50% condition threshold and critical colony infrastructure from a 75% threshold. The critical envelope includes spawns, extensions, towers, storage, terminal, links, labs, factory, observer, power spawn, nuker, and extractor. Planned ramparts use the defensive target above.

## Mature energy authorization boundary

The RCL8 projection includes staged source, core, and controller link geometry. The pure routing policy accounts for Screeps post-loss delivery and can fill a partial sink exactly without exceeding its usable capacity. Live `linkTransfer` intent planning remains disabled, however: the approved colony energy-service Task has no Procedure whose intent allowlist authorizes that command. Runtime telemetry reports `authorization-debt`, and source/container hauling remains the operational fallback until an accountable, versioned Task supersession supplies that authority. Prepared geometry and tested policy are not reported as an active service.

## Evidence and observability

The runtime publishes the controller level, plan horizon status, active and next stage, weighted realization, missing and blocked structure counts, next milestone, and defensive perimeter condition.

Legacy or malformed plans are deliberately unscored. A version 3/RCL3 plan in an RCL8 room reports a horizon gap and a replacement milestone instead of manufacturing a healthy construction score.

## Debug commands

```js
roomPlan("W39S23")
invalidateRoomPlan("W39S23", "reason")
```

Invalidation marks the current plan; the settlement planner replaces it on the next eligible tick.

## Design references

- [Official Screeps mechanics](https://docs.screeps.com/)
- [Controller/RCL limits](https://docs.screeps.com/control.html)
- [Community automatic base-building patterns](https://wiki.screepspl.us/Automatic_base_building/)
- [Community maturity patterns](https://wiki.screepspl.us/Maturity_Matrix/)

The implementation combines terrain-derived planning for arbitrary rooms with small validated local stamps where topology matters, such as the reaction lab cluster.
