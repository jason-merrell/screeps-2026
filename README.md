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

## Workspace

The repository is orchestrated with Turborepo and pnpm workspaces:

```text
apps/
  screeps-lab/          Vercel control-plane shell
packages/
  runtime/              production Screeps runtime and tests
scenario/               headless private-server harness
scripts/                deploy, insights, replay, and build tooling
```

Turborepo owns task ordering and cache boundaries. Vercel Remote Cache is used by GitHub Actions through OIDC, while the heavyweight private-server dependency remains isolated to the scenario runtime.

## Development

Requires Node.js 22+ and pnpm.

```bash
pnpm install --frozen-lockfile=false
pnpm check
pnpm build
```

Useful focused commands:

```bash
pnpm build:runtime
pnpm build:scenario
pnpm lab:build
pnpm scenario:headless
```

The production Screeps bundle is emitted to `packages/runtime/dist/main.js`.

## Runtime structure

```text
packages/runtime/src/
  intents/       intent contracts, arbitration, execution
  memory/        durable schema and migrations
  runtime/       tick and CPU context
  systems/       domain planners
  workforce/     capability model
  world/         perception and normalized tick snapshot
```
