import { invalidateRoomPlan } from "../systems/settlement/plan";

const summarize = (roomName: string): string => {
  const plan = Memory.colonies[roomName]?.roomPlan;
  if (!plan) return `No room plan for ${roomName}`;

  const automatic = plan.structures.filter((structure) => structure.activation === "automatic");
  const demand = plan.structures.filter((structure) => structure.activation === "demand");
  return [
    `Room plan ${roomName} v${plan.version} horizon=RCL${plan.horizonRcl}`,
    `generated=${plan.generatedAt} reason=${plan.generatedReason}`,
    `hub=(${plan.anchors.hub.x},${plan.anchors.hub.y})`,
    `automatic structures=${automatic.length}`,
    `demand-gated structures=${demand.length}`,
    `strategic road tiles=${plan.roads.length}`,
    `road edges=${plan.roadGraph.edges.length}`,
    `defense=${plan.defense.strategy}`,
  ].join("\n");
};

export const installRoomPlanDebug = (): void => {
  const globals = globalThis as typeof globalThis & {
    roomPlan?: (roomName: string) => string;
    invalidateRoomPlan?: (roomName: string, reason?: string) => string;
  };

  globals.roomPlan = (roomName: string) => {
    const report = summarize(roomName);
    console.log(report);
    return report;
  };

  globals.invalidateRoomPlan = (roomName: string, reason = "manual console invalidation") => {
    const invalidated = invalidateRoomPlan(roomName, reason);
    const report = invalidated
      ? `Invalidated room plan for ${roomName}: ${reason}`
      : `No room plan exists for ${roomName}`;
    console.log(report);
    return report;
  };
};
