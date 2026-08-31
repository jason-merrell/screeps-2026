import { defensiveRampartTargetHits } from "../defense/readiness";

const CRITICAL_INFRASTRUCTURE = new Set<StructureConstant>([
  "spawn",
  "extension",
  "tower",
  "storage",
  "terminal",
  "link",
  "lab",
  "factory",
  "observer",
  "powerSpawn",
  "nuker",
  "extractor",
]);

/**
 * Shared condition threshold for repair planning and completion evidence.
 * A zero result means that routine repair is outside this governed envelope.
 */
export function infrastructureRepairThreshold(
  structureType: StructureConstant,
  hitsMax: number,
  controllerLevel: number | undefined,
  underAttack = false,
): number {
  if (hitsMax <= 0) return 0;
  if (structureType === "rampart") {
    return Math.min(
      hitsMax,
      defensiveRampartTargetHits(controllerLevel ?? 0, underAttack),
    );
  }
  if (structureType === "road" || structureType === "container") {
    return hitsMax * 0.5;
  }
  if (CRITICAL_INFRASTRUCTURE.has(structureType)) return hitsMax * 0.75;
  return 0;
}
