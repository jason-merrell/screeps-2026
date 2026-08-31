/**
 * Compatibility entry point for the canonical EQVM Task-QI calculator.
 *
 * Per-intent execution observations intentionally do not write this evidence
 * stream. Only `recordCompletedKpi` in the Activity lifecycle may append a
 * terminal Activity KPI sample; operational execution telemetry remains in the
 * Activity metrics/assignment evidence path.
 */
export {
  activityKpiMultiplier,
  computeEqvmResearchEstimate,
  computeVerifiedTaskQi as computeTaskQi,
  FSPM_ACTIVITY_KPI_AGGREGATION_POLICY,
  FSPM_ACTIVITY_KPI_POLICY_CONTENT_HASH,
  type TaskQiEvidenceContext,
} from "./eqvm";
