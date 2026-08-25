import type { RoomPlan } from "../../planning/room-plan";

function stripPlannerMetadata(plan: RoomPlan): RoomPlan {
  return JSON.parse(
    JSON.stringify(plan, (key, value) => (key === "score" ? undefined : value)),
  ) as RoomPlan;
}

export function normalizeFreshRoomPlans(): void {
  for (const colony of Object.values(Memory.colonies)) {
    const plan = colony.roomPlan;
    if (!plan || plan.generatedAt !== Game.time) continue;
    colony.roomPlan = stripPlannerMetadata(plan);
  }
}
