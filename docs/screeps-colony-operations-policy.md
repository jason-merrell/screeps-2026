# Screeps Colony Operations Policy

- Policy ID: `2026.08.30-Screeps Colony Operations Policy v1`
- Revision: 1
- Effective date: 2026-08-30
- Authority package: `authority-package:empire:colony-operations:v1`
FSPM governance baseline: `Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`

## Purpose

This source-controlled policy is the immutable requirement source for the initial colony-operations authority package. It defines four discrete obligations. The runtime may project them into an owned colony only through the separately validated authority-package import; discovering demand or constructing an intent cannot create, approve, or activate them.

## Binding obligations

### Economy

Each owned colony shall maintain a continuous, recoverable energy service that extracts, buffers, transports, and applies energy to governed operational demand.

### Spawning

Each owned colony shall maintain viable workforce capacity for bootstrap recovery, source production, logistics throughput, and general governed demand.

### Construction

Each owned colony shall realize its governed room plan and maintain operational infrastructure at the defined service thresholds.

### Defense

Each owned colony shall maintain bounded defensive readiness and engage detected hostile threats with available governed capability.

## Screeps adaptation boundary

The package uses a source-controlled accountable service principal because the runtime does not yet contain the human Employee, Position, OU, and ARCI registry tracked by issue #164. Its attestation must not be represented as a human signature. Dates identify the source-controlled policy revision; runtime creation, import, evidence, and receipt times use authoritative game ticks.

The four Corporate Deliverables are recurring services. A successful game command is execution evidence, not a Deliverable receipt. Runtime capture may record a hash-bound `received` observation only from a completed Activity with terminal KPI evidence. The compact receipt remains durable even after its bounded live Activity record is pruned. A separate immutable decision may then record `accepted`, `rejected`, or `disputed` under the package-bound accountable Screeps service principal. The package policy permits acceptance only for `satisfactory` or `exceptional` terminal KPI evidence.

Receipt capture and receipt decision are explicit authority mutations, not automatic consequences of Activity completion. Production automatic reconciliation remains disabled until the bounded, durably acknowledged evidence-archive controls tracked by #194 exist.

An accepted decision closes that service occurrence; it does not complete the recurring service definition. The definition remains Active until a separately governed closure or supersession criterion exists. This is an autonomous-system adaptation, not canonical human acceptance; the human authority chain remains issue #164. Operational room health is not DQI or PQI. Exact Task and Deliverable roll-up formulas are implemented, but canonical Task QI/DQI/PQI stay unavailable because recurring Activity weights and reporting-period policy lack accountable approval; issue #136 retains that approval plus human-reviewed, durable, and broader EVM/EQV follow-through.
