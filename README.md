# screeps-2026

A greenfield Screeps bot built around **PPAE: Perception → Planning → Arbitration → Execution**.

The architecture treats Screeps as a persistent, tick-driven, CPU-budgeted control system rather than an object hierarchy of roles and managers.

## Principles

- Systems observe world state and **propose intents**.
- Arbitration resolves competing intents before game mutations occur.
- Execution is the single boundary that calls mutation-oriented Screeps APIs.
- Creeps are modeled by **capabilities derived from body parts**, not permanent roles.
- `Memory` is durable, versioned state; transient caches should remain disposable.
- CPU bucket state is part of the tick context and can drive future planning policy.
- No process kernel, manager tree, or enterprise-style abstraction until the game earns one.

## Tick flow

```text
Game.*
  ↓
Perception
  ↓
WorldSnapshot
  ↓
Planning systems
  ↓
Proposed intents
  ↓
Arbitration
  ↓
Accepted intents
  ↓
Execution
  ↓
Game commands
```

## Current vertical slice

The initial bot can:

1. migrate and validate versioned Memory;
2. perceive owned rooms, creeps, spawns, and CPU state;
3. bootstrap a `[WORK, CARRY, MOVE]` worker when the colony has no creeps;
4. infer creep capabilities from active body parts;
5. harvest energy, refill spawns/extensions, and use surplus energy to upgrade;
6. resolve conflicting actions deterministically before execution.

This is deliberately small. The purpose of the first milestone is to prove the architecture with a living colony before adding richer logistics, construction, defense, expansion, or scheduling systems.

## Development

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm check
pnpm build
```

The Screeps bundle is emitted to `dist/main.js`.

## Structure

```text
src/
  intents/       intent contracts, arbitration, execution
  memory/        durable schema and migrations
  runtime/       tick and CPU context
  systems/       domain planners
  workforce/     capability model
  world/         perception and normalized tick snapshot
```
