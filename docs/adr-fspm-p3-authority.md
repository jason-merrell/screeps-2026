# ADR: FSPM P3 authority for Screeps empire and colonies

## Status

Accepted for the #175 migration slice, subject to exact-merged-SHA PTR acceptance.

## Authoritative governance source

This decision was reviewed against:

- `Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`
- `execution/data/p3.md`

The source is authoritative for P3 Type/Sub-Type discrimination, parent-child rules, and P3 lifecycle semantics.

## Context

The runtime historically modeled every owned Screeps colony as an FSPM `service_program` and created a synthetic `contract:colony:<room>` authority record. That mapping is invalid under FSPM.

FSPM defines a Service Program as the coordinated set of interrelated projects and activities used to deliver services to a federal customer under an awarded Federal contract. Service Program creation is triggered by contract award and contractual Period of Performance is part of its temporal authority. A Screeps colony has no Federal customer, awarded contract, or contractual Period of Performance.

FSPM defines a Portfolio as a continuously managed collection of projects, programs, sub-portfolios, and related work that is prioritized and rebalanced against strategic objectives. It further states that ongoing operational coordination belongs under a Portfolio rather than a Program. This is the discriminating test that fits permanent colony operations.

FSPM also states that P3 Type and Sub-Type are immutable after creation. If the original classification is wrong, the existing P3 must be closed and a new correctly typed P3 created; descendants are migrated rather than mutating the old P3 in place.

## Decision

### Root authority

`portfolio:empire:operations` is the root Screeps P3 and is modeled as:

- Type: `portfolio`
- Sub-Type: `ou_portfolio`
- Parent: `null`
- Purpose: continuously prioritize and rebalance owned colonies and subordinate P3 work against empire operating objectives

For this domain, **Empire Operations is the root OU analogue**. The runtime does not yet implement NTI's complete OU/ARCI organizational schema; that broader parity work remains tracked separately. The root Portfolio role is nevertheless explicit so subordinate P3 records do not float without management authority.

### Colony authority

Each owned colony receives `portfolio:colony:<room>` as a subordinate Portfolio:

- Type: `portfolio`
- Sub-Type: `ou_portfolio`
- Parent: `portfolio:empire:operations`
- Purpose: continuously manage economy, workforce, construction, defense, expansion, and other colony operating components

This uses FSPM's rule that subordinate Portfolios inherit the OU Portfolio Sub-Type and are distinguished by their parent chain rather than a separate subtype.

### Legacy authority

Existing Service Program and synthetic contract records are **retired and preserved as historical evidence**. They are never retyped or deleted.

Existing Activity identity and Task lineage are not rewritten by this migration. Current requirements acquire `p3Id` authority while legacy `contractId` remains only where needed to decode historical evidence. New intents emit `p3Id` and do not emit synthetic `contractId`.

## Screeps temporal adaptation

FSPM requires a `Start Date` for every P3. Screeps execution, deterministic replay, and private-engine benchmarks use game ticks as their canonical temporal coordinate; historical game ticks do not have a trustworthy reversible mapping to a civil calendar date.

The runtime therefore records:

- `temporalBasis = "game_tick"`
- `startTick = <governed establishment tick>`

This is an explicit domain adaptation, **not a claim that game tick is literally the FSPM database `start_date` field**. No wall-clock date is fabricated from a game tick. A future integration layer may add a civil-date observation when a reliable external capture timestamp is available, but it must not replace the deterministic runtime authority of `startTick`.

For the Empire root, `startTick` is the earliest known colony discovery tick when migrating existing memory. For a Colony Portfolio, `startTick` is that colony's `discoveredAt` tick.

## Observability and compatibility

Segment 99 exposes:

- root P3 authority;
- current Colony P3 authority;
- current P3 quality history;
- nullable retired legacy Service Program/contract evidence;
- requirements with current `p3Id` authority.

Screeps Lab accepts both telemetry eras during rollout:

- pre-v6 snapshots without `p3` continue to render their historical program/contract projection;
- v6 snapshots with `p3` normalize current P3 health into the existing compatibility UI surface while preserving legacy records separately;
- legacy authority never drives current health once a v6 P3 exists.

Durable Supabase Activity/event history is authority-agnostic for this change because persistence walks `fspm.colonies[].activities` and `activityEvents` rather than requiring program/contract fields.

## Rejected alternatives

### Keep Service Program and rename the contract

Rejected. The classification fails the FSPM discriminating test and invents a Federal-contract relationship that does not exist.

### Mutate the existing Service Program into a Portfolio

Rejected. FSPM explicitly prohibits in-place Type/Sub-Type changes.

### Use a General Program for permanent colony operations

Rejected. A Program is defined by coordinated management of multiple related Projects toward bounded strategic benefits. FSPM explicitly places ongoing operational coordination under a Portfolio.

### Use a General Project as the permanent colony container

Rejected. A Project is a temporary endeavor with a defined end and specified deliverables. Permanent colony operations are open-ended.

### Fabricate calendar Start Dates from Screeps ticks

Rejected. That would create false temporal evidence and damage deterministic replay semantics.

## Consequences and follow-up

This ADR corrects the authority spine but does not claim complete P3 schema parity. Remaining governed work includes:

- #164: full FSPM schema / OU / ARCI parity, including any canonical naming and civil-date integration requirements;
- #176: General Project for temporary colony development to a mature operating base and stage-result Child Deliverables;
- #134: operator-cockpit presentation cleanup so legacy labels such as "Contract trend" are replaced by P3-native language;
- schema tightening after durable consumers no longer need the temporary optional decoder fields.

## Release acceptance

#175 is not complete until an exact merged SHA is deployed to PTR and live evidence proves:

1. Memory schema is v6.
2. Root Empire Portfolio exists and is active.
3. Colony Portfolio exists with `parentP3Id = portfolio:empire:operations`.
4. Existing Service Program and synthetic contract are retired or absent on a fresh colony.
5. Newly accepted intent traces contain current `p3Id`.
6. Newly accepted intent traces do not contain synthetic `contractId`.
7. Existing Activity identity/history survives the migration.
8. Screeps Lab and Supabase observability continue to ingest/read the resulting telemetry.
