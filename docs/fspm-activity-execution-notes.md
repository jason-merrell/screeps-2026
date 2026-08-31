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
- An explicitly unapproved research configuration gives one equal unit to each of the latest 24 verified terminal Activity KPI samples inside a 1,500-tick window; it is stored outside governed Task records.
- Canonical Task QI is null with `activity_weight_policy_unapproved`; the separately named research estimate also withholds a number for missing, partial, stale, duplicate, extra, cross-Task, or unverified evidence.
- Exact Task and Deliverable weight formulas are implemented without renormalizing around gaps, but DQI/PQI remain unavailable while canonical Task QI is withheld.
- Room readiness and current execution risk are separately named operational health and cannot enter EQVM.
- Completion-only KPI history, Activity events, compact Segment 99 evidence, and Supabase durable history are available for review.

Known conformance blockers:

- Corporate Requirements and Deliverables are activated from an exact source-controlled package with append-only activation, receipt-evidence, receipt-decision, and retirement ledgers; approval and acceptance use a disclosed service-principal adaptation.
- Receipt and decision append APIs are explicit and separately atomic; the production loop does not automatically reconcile terminal Activities into occurrence evidence. Bounded acknowledged archival must land under #194 before that path is enabled.
- Canonical human Employee/Position/OU and ARCI authority, including exactly one human Accountable, is absent under #164.
- General one-level child-Deliverable decomposition remains #176.
- Planned Activity start/due semantics, inherited Task Description and Task Weight, and transition authority are incomplete.
- Bounded runtime history has no durable collector acknowledgment or gap detector.
- Canonical human reviewer approval and dispute governance remain absent; terminal evidence verification is the disclosed service-principal adaptation.
- Accountable approval of recurring Activity weights, cohort length, and freshness policy is absent; research telemetry cannot be presented as Task QI.
- P3/PQI over the current OU Portfolio applies the canonical weighted formula as a disclosed Portfolio reporting adaptation because the governance guide labels PQI at project/program level.
- Receipt and decision ledgers have no bounded checkpoint/archive or durable ACK protocol; #194 tracks the required lossless design.

`docs/fspm-conformance.json` is the authoritative machine-checkable map. This checkpoint must never be used alone to claim complete NTI FSPM parity.
