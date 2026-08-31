import {
  CANONICAL_MATURE_STRUCTURE_COUNTS,
  CANONICAL_STRUCTURE_COUNTS_BY_RCL,
  type CanonicalMatureStructureType,
} from "../../src/planning/room-development";
import type { RoomPlan } from "../../src/planning/room-plan";
import { migrateRoomPlanProjection } from "../../src/planning/room-plan-projection";
import { normalizeRoomPlanProjection } from "../../src/systems/settlement/normalize";

export const CANONICAL_FIXTURE_STRUCTURE_ID_PREFIX = "canonical-fixture";

const pointKey = (point: { x: number; y: number }): string =>
  `${point.x}:${point.y}`;

function fixtureStage(minRcl: number) {
  if (minRcl <= 3) return "bootstrap" as const;
  if (minRcl <= 5) return "core-economy" as const;
  if (minRcl <= 7) return "advanced-operations" as const;
  return "mature-rcl8" as const;
}

function fixturePhase(
  structureType: CanonicalMatureStructureType,
  minRcl: number,
) {
  if (structureType === "extension")
    return minRcl <= 3
      ? ("bootstrap-capacity" as const)
      : ("capacity-expansion" as const);
  if (structureType === "tower")
    return minRcl <= 3
      ? ("bootstrap-defense" as const)
      : ("defense-envelope" as const);
  if (structureType === "spawn")
    return minRcl <= 1
      ? ("bootstrap-capacity" as const)
      : minRcl <= 7
        ? ("advanced-operations" as const)
        : ("mature-operations" as const);
  if (structureType === "storage") return "core-economy" as const;
  if (structureType === "link") return "energy-distribution" as const;
  return minRcl <= 7
    ? ("advanced-operations" as const)
    : ("mature-operations" as const);
}

/** Add only missing fixed-inventory records; caller-supplied canaries stay intact. */
export function canonicalRoomPlanInventoryFixture(plan: RoomPlan): RoomPlan {
  const structures = plan.structures.map((structure) => ({ ...structure }));
  const occupied = new Set([
    ...structures.map(pointKey),
    ...plan.roads.map(pointKey),
    ...plan.reservations.map(pointKey),
    pointKey(plan.anchors.spawn),
    pointKey(plan.anchors.hub),
    ...plan.anchors.sources.flatMap((source) => [
      pointKey(source),
      pointKey(source.container),
    ]),
    ...(plan.anchors.controller
      ? [
          pointKey(plan.anchors.controller),
          pointKey(plan.anchors.controller.service),
        ]
      : []),
    ...plan.defense.protectedTiles.map(pointKey),
    ...plan.defense.perimeter.map(pointKey),
  ]);
  const usedIds = new Set([
    ...structures.map((structure) => structure.id),
    ...plan.roads.map((road) => road.id),
  ]);
  const candidatePoints: Array<{ x: number; y: number }> = [];
  for (let x = 2; x <= 47; x += 1) {
    for (let y = 2; y <= 47; y += 1) candidatePoints.push({ x, y });
  }
  let nextPoint = 0;
  const allocatePoint = (): { x: number; y: number } => {
    while (nextPoint < candidatePoints.length) {
      const candidate = candidatePoints[nextPoint];
      nextPoint += 1;
      if (!candidate || occupied.has(pointKey(candidate))) continue;
      occupied.add(pointKey(candidate));
      return candidate;
    }
    throw new Error(
      "canonical room-plan fixture exhausted interior coordinates",
    );
  };

  for (const structureType of Object.keys(
    CANONICAL_MATURE_STRUCTURE_COUNTS,
  ) as CanonicalMatureStructureType[]) {
    let ordinal = structures.filter(
      (structure) => structure.structureType === structureType,
    ).length;
    for (let rcl = 1; rcl <= 8; rcl += 1) {
      const expected =
        CANONICAL_STRUCTURE_COUNTS_BY_RCL[structureType][rcl] ?? 0;
      let committed = structures.filter(
        (structure) =>
          structure.structureType === structureType && structure.minRcl <= rcl,
      ).length;
      while (committed < expected) {
        ordinal += 1;
        let id = `${CANONICAL_FIXTURE_STRUCTURE_ID_PREFIX}-${structureType}-${ordinal}`;
        while (usedIds.has(id)) id = `${id}-next`;
        usedIds.add(id);
        structures.push({
          id,
          ...allocatePoint(),
          structureType,
          minRcl: rcl,
          priority: 100 - ordinal,
          activation: "automatic",
          reservation: "hard",
          phase: fixturePhase(structureType, rcl),
          reason: `canonical ${structureType} inventory fixture`,
          stage: fixtureStage(rcl),
          strategicWeight: 1,
          requiredForStage: true,
        });
        committed += 1;
      }
    }
  }
  return { ...plan, structures };
}

/**
 * Admit a test projection through the same epoch migration and publication
 * normalization used by the runtime. Consumer tests should only bypass this
 * helper when malformed or stale projection evidence is the subject under test.
 */
export function currentRoomPlanFixture(plan: RoomPlan): RoomPlan {
  return normalizeRoomPlanProjection(
    migrateRoomPlanProjection(canonicalRoomPlanInventoryFixture(plan)),
  );
}
