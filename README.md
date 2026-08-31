# screeps-2026

A greenfield Screeps bot built around **PPAE: Perception → Planning → Arbitration → Execution**.

The architecture treats Screeps as a persistent, tick-driven, CPU-budgeted control system rather than an object hierarchy of roles and managers.

## Principles

- Systems observe world state and **propose intents**.
- Arbitration resolves competing intents before game mutations occur.
- Execution is the single boundary that calls mutation-oriented Screeps APIs.
- Creeps are modeled by **capabilities derived from body parts**, not permanent roles.
- `Memory` is durable, versioned state; transient caches should remain disposable.
- CPU bucket state drives deterministic survival/mandatory/deferrable phase policy, bounded cadence, and deadline headroom.
- No process kernel, manager tree, or enterprise-style abstraction until the game earns one.

## FSPM conformance

The runtime implements a strong NTI FSPM execution slice, but it does not claim full framework parity yet. A content-pinned authority package now activates the complete v1 root-authority catalog of Corporate Requirements, root Corporate Deliverables, Tasks, and Procedures before planning; execution, outcome, and completion-only KPI lineage are governed against `Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`.

The machine-checkable profile at `docs/fspm-conformance.json` maps canonical fields and invariants to `implemented`, `adapted`, `not_implemented`, or `not_applicable`. It is the authoritative statement of parity; narrative documentation and UI labels may not overrule it.

```bash
node scripts/validate-fspm-conformance.mjs
pnpm report:fspm
```

The current blockers are canonical human Employee/Position/OU and ARCI authority, general child-Deliverable decomposition, accountable approval of the recurring-Activity weighting/reporting policy plus a governed ledger that can resolve it before the rated cohort, a governed financial/EVM baseline and lossless human-reviewed EQVM history, continuously governed Portfolio decisions, automatic Deliverable-occurrence reconciliation with bounded acknowledged archival, durable history acknowledgment, and Issue/Risk/Stakeholder registers. Source-controlled service-principal activation is an explicit Screeps adaptation, never a claim of human approval.

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
Fail-closed FSPM authority validation
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

Requires Node.js 22.18.0 (pinned in `.node-version`) and pnpm 10.15.0.

```bash
pnpm install --frozen-lockfile
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

Runtime pressure and fault-containment semantics are specified in
[`docs/adr-runtime-supervisor.md`](docs/adr-runtime-supervisor.md); its open
scale and fairness gates remain tracked in issue #186.

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
