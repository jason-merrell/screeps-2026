export const RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD = 160_000;

export type ControllerSpendMode = "progress" | "maintenance" | "none";

export interface ControllerMaintenanceCandidate {
  name: string;
  work: number;
  energy: number;
  range: number;
}

/**
 * Separate room progression from capped-room ownership maintenance.
 *
 * RCL8 upgrading still produces GCL, but GCL investment is an empire-level
 * strategic choice and must never be inferred merely because a local creep has
 * surplus energy. Capped rooms therefore fail closed to no controller spend
 * unless their downgrade buffer crosses the governed maintenance threshold.
 */
export function controllerSpendMode(
  level: number | undefined,
  ticksToDowngrade: number | undefined,
): ControllerSpendMode {
  if (level === undefined || level <= 0) return "none";
  if (level < 8) return "progress";
  if (
    level === 8 &&
    ticksToDowngrade !== undefined &&
    ticksToDowngrade < RCL8_DOWNGRADE_MAINTENANCE_THRESHOLD
  ) {
    return "maintenance";
  }
  return "none";
}

/**
 * Use one minimal-capacity performer for downgrade maintenance. The timer has
 * a very large safety runway, so minimizing WORK first avoids unnecessary
 * energy overshoot; range and name make the selection efficient and stable.
 */
export function selectControllerMaintenanceAssignee(
  candidates: ControllerMaintenanceCandidate[],
): string | undefined {
  return [...candidates]
    .filter((candidate) => candidate.work > 0 && candidate.energy > 0)
    .sort(
      (left, right) =>
        left.work - right.work ||
        left.range - right.range ||
        left.name.localeCompare(right.name),
    )[0]?.name;
}
