# FSPM Activity Execution Implementation Checkpoint

This checkpoint accompanies `docs/adr-fspm-activity-execution.md` and is governed against `Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7`.

Implemented execution semantics:

- Task definitions are Active or Retired and do not complete because a planner is silent for one tick.
- Canonical Task definitions include Description, Task Weight, Quality Description, Quality Metric, KPI rubric, Procedures, and documented Task-or-Procedure determination.
- Intent traces include P3, Requirement, Deliverable, Task, and Procedure identity.
- Winning intents bind to persistent colony-owned Activity records after arbitration.
- Activities traverse Not Started before In Progress and persist across ticks.
- Procedure changes within one Task preserve Activity identity.
- Switching an assignee away from unfinished work places the Activity On Hold and records preemption evidence.
- Returning to held work resumes the same Activity; performer reassignment preserves work identity and history.
- Activity evidence distinguishes productive work, required travel, blocked work, idle ticks, holds, resumes, Procedure transitions, and Task preemptions.
- Task-specific terminal predicates evaluate Activity outcomes before assigning a terminal KPI rating.
- Tick-level commands cannot independently create Task QI credit.
- Completion-only KPI history, Activity events, compact Segment 99 evidence, and Supabase durable history are available for review.

Known conformance blockers:

- Corporate Requirements and Deliverables are activated from an exact source-controlled package with append-only activation, receipt-evidence, receipt-decision, and retirement ledgers; approval and acceptance use a disclosed service-principal adaptation.
- Receipt and decision append APIs are explicit and separately atomic; the production loop does not automatically reconcile terminal Activities into occurrence evidence. Bounded acknowledged archival must land under #194 before that path is enabled.
- Canonical human Employee/Position/OU and ARCI authority, including exactly one human Accountable, is absent under #164.
- General one-level child-Deliverable decomposition remains #176.
- Planned Activity start/due semantics, inherited Task Description and Task Weight, and transition authority are incomplete.
- Task QI is not yet rolled through Task Weight to DQI and Deliverable Weight to P3/PQI.
- Room operational health is still represented in fields named as FSPM quality and must not be interpreted as EQVM.
- Bounded runtime history has no durable collector acknowledgment or gap detector.
- Receipt and decision ledgers have no bounded checkpoint/archive or durable ACK protocol; #194 tracks the required lossless design.

`docs/fspm-conformance.json` is the authoritative machine-checkable map. This checkpoint must never be used alone to claim complete NTI FSPM parity.
