import type { RoomPlan, RoomPlanRoad } from "./room-plan";

export interface ConstructionTargetCandidate {
  id: string;
  x: number;
  y: number;
  structureType: BuildableStructureConstant;
  range: number;
}

export function plannedRoadPriority(plan: RoomPlan, road: RoomPlanRoad): number {
  let priority = 300;

  for (const edge of plan.roadGraph.edges) {
    if (!edge.tiles.some((tile) => tile.x === road.x && tile.y === road.y)) continue;

    if (edge.from === "spawn" && edge.to === "hub") {
      priority = Math.max(priority, 360);
    } else if (edge.to.startsWith("source-")) {
      priority = Math.max(priority, 340);
    } else if (edge.to === "controller") {
      priority = Math.max(priority, 220);
    }
  }

  return priority;
}

export function plannedConstructionPriority(
  plan: RoomPlan | undefined,
  candidate: Pick<ConstructionTargetCandidate, "x" | "y" | "structureType">,
): number {
  if (!plan) return candidate.structureType === "road" ? 200 : 0;

  const structure = plan.structures.find(
    (planned) =>
      planned.x === candidate.x &&
      planned.y === candidate.y &&
      planned.structureType === candidate.structureType,
  );
  if (structure) return structure.priority;

  if (candidate.structureType === "road") {
    const road = plan.roads.find(
      (planned) => planned.x === candidate.x && planned.y === candidate.y,
    );
    return road ? plannedRoadPriority(plan, road) : 200;
  }

  return 0;
}

export function compareConstructionTargets(
  plan: RoomPlan | undefined,
  left: ConstructionTargetCandidate,
  right: ConstructionTargetCandidate,
): number {
  const priorityDifference =
    plannedConstructionPriority(plan, right) - plannedConstructionPriority(plan, left);
  return priorityDifference || left.range - right.range || left.id.localeCompare(right.id);
}
