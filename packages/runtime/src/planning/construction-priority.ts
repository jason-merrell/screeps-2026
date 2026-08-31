import type { RoomPlan, RoomPlanRoad } from "./room-plan";

export interface ConstructionTargetCandidate {
  id: string;
  x: number;
  y: number;
  structureType: BuildableStructureConstant;
  range: number;
}

export interface ConstructionTargetContext {
  underAttack?: boolean;
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
  context: ConstructionTargetContext = {},
): number {
  const threatClass = (candidate: ConstructionTargetCandidate): number => {
    if (!context.underAttack) return 0;
    const closesPerimeter =
      candidate.structureType === "rampart" &&
      (plan?.defense.perimeter.some(
        (point) => point.x === candidate.x && point.y === candidate.y,
      ) ?? false);
    if (closesPerimeter) return 0;
    if (
      candidate.structureType === "tower" ||
      candidate.structureType === "spawn"
    ) {
      return 1;
    }
    return 2;
  };
  const threatDifference = threatClass(left) - threatClass(right);
  if (threatDifference !== 0) return threatDifference;
  const priorityDifference =
    plannedConstructionPriority(plan, right) - plannedConstructionPriority(plan, left);
  const strategicWeight = (candidate: ConstructionTargetCandidate): number =>
    plan?.structures.find(
      (structure) =>
        structure.x === candidate.x &&
        structure.y === candidate.y &&
        structure.structureType === candidate.structureType,
    )?.strategicWeight ?? 0;
  const weightDifference = strategicWeight(right) - strategicWeight(left);
  return (
    priorityDifference ||
    weightDifference ||
    left.range - right.range ||
    left.id.localeCompare(right.id)
  );
}
