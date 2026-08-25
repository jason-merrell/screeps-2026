# Room planning

Room construction follows a durable desired-state model:

> Plan globally, build incrementally, replan reluctantly.

## Responsibilities

- **Settlement planning** decides where the room is intended to grow.
- **Construction planning** decides which already-planned automatic structure should become a construction site now.
- **Economy/workforce systems** decide how energy and worker effort are allocated to active construction.
- **Execution** remains the only layer that mutates `Game.*`.

## Current plan horizon

Room plan version 2 intentionally plans through RCL3 rather than pretending to solve the complete RCL8 layout up front. Version 2 also normalizes persisted geometry so temporary candidate-scoring metadata never becomes part of the durable plan schema.

It persists:

- the existing spawn anchor;
- a terrain-scored future storage/logistics hub reservation;
- ten terrain-adapted rapid-fill extension slots (five at RCL2, five at RCL3);
- a first-tower location for RCL3;
- reserved source and controller logistics tiles;
- a merged strategic road graph between spawn, hub, sources, and controller;
- a protected-footprint seed for a future terrain-aware min-cut defense planner.

Normal RCL changes do **not** regenerate the plan. Regeneration happens only when the plan is missing, its plan schema version changes, or it is explicitly invalidated.

## Capital activation

A planned coordinate is not automatically a construction commitment.

Every planned structure or road has an activation mode:

- `automatic`: bootstrap infrastructure whose immediate value is already justified;
- `demand`: reserved infrastructure that requires another system to demonstrate economic or defensive demand before construction.

The current plan automatically builds extension capacity and the first RCL3 tower. Source/controller containers, strategic roads, and protective ramparts are demand-gated.

This prevents early construction from spending thousands of energy on infrastructure that the current generalist economy cannot yet exploit.

## Roads

Roads are planned as a graph, not independent spawn-to-target paths. Previously planned road tiles are assigned the cheapest route cost while subsequent edges are searched, encouraging shared trunks and route merging.

The graph is persisted, but its tiles are demand-gated. A later traffic/ROI system can activate road segments using observed traversal frequency, terrain savings, and hauling demand without changing the underlying room geometry.

## Defense

The current plan records the economically valuable footprint but deliberately does not invent a static rampart perimeter. The defense strategy is marked `pending-mincut` so a later terrain graph can derive a compact perimeter around protected assets using flood-fill/min-cut techniques.

## Debug commands

```js
roomPlan("W39S23")
invalidateRoomPlan("W39S23", "reason")
```

Invalidation marks the current plan; the settlement planner regenerates it on the next tick.

## Design references

- Official Screeps mechanics: https://docs.screeps.com/
- Controller/RCL limits: https://docs.screeps.com/control.html
- Community automatic base-building patterns (stamps, flood fill, min-cut): https://wiki.screepspl.us/Automatic_base_building/
- Community maturity patterns for roads: https://wiki.screepspl.us/Maturity_Matrix/

The implementation favors known-good local stamps for compact structure groups and terrain-derived graph planning for roads and future defense.
