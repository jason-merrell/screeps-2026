const PEACETIME_RAMPART_TARGET_BY_RCL = [
  0, 0, 0, 10_000, 50_000, 250_000, 750_000, 2_000_000, 5_000_000,
] as const;

/**
 * Returns the condition target for a planned defensive rampart.
 *
 * The target deliberately grows with colony capability instead of treating the
 * RCL3 bootstrap floor as a permanent definition of defensive readiness.
 */
export function defensiveRampartTargetHits(
  controllerLevel: number,
  underAttack = false,
): number {
  const boundedLevel = Math.max(0, Math.min(8, Math.floor(controllerLevel)));
  const peacetime = PEACETIME_RAMPART_TARGET_BY_RCL[boundedLevel] ?? 0;
  return underAttack ? peacetime * 2 : peacetime;
}
