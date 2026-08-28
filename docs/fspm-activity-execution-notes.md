# FSPM Activity Execution Implementation Checkpoint

This checkpoint accompanies `docs/adr-fspm-activity-execution.md`.

The first implementation slice intentionally changes ontology and observability before scheduler policy:

- Task definitions are Active/Retired and do not complete because a planner is silent for one tick.
- Intent traces include Procedure identity.
- Winning creep intents bind to persistent colony-owned Activity records after arbitration.
- Procedure changes within the same Task preserve Activity identity.
- Switching an assignee to a different Task places the previous Activity On Hold and records a Task preemption.
- Returning to a held Task resumes the same Activity.
- Activity evidence distinguishes productive work, required travel, idle/reorientation, hold ticks, Procedure transitions, holds/resumes, and Task preemptions.
- Activity Continuity Ratio is exposed from the bounded Activity record.
- Tick-level command results no longer create Task QI samples.
- Memory v3 clears legacy command-level Activity/QI evidence because it was measured under superseded semantics.

This slice does not yet define Task-specific Activity completion evaluators or assign KPI Score. Per governance, KPI Score remains pending until an Activity reaches Completed and its outcome is evaluated against the Task Quality Metric.

Scheduler stickiness and focus behavior remain unchanged until live telemetry establishes the baseline failure modes.
