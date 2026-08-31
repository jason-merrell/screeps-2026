import type { RoomPlan } from "../../planning/room-plan";
import { roomPlanProjectionFingerprint } from "../../planning/room-plan-projection";

function stripPlannerMetadata(plan: RoomPlan): RoomPlan {
  return JSON.parse(
    JSON.stringify(plan, (key, value) => (key === "score" ? undefined : value)),
  ) as RoomPlan;
}

export function normalizeRoomPlanProjection(plan: RoomPlan): RoomPlan {
  const normalized = stripPlannerMetadata(plan);
  normalized.projectionFingerprint = roomPlanProjectionFingerprint(normalized);
  return normalized;
}

export function normalizeFreshRoomPlans(): void {
  for (const colony of Object.values(Memory.colonies)) {
    const plan = colony.roomPlan;
    if (!plan || plan.generatedAt !== Game.time) continue;
    const normalized = stripPlannerMetadata(plan);
    const containedPlannerMetadata =
      JSON.stringify(normalized) !== JSON.stringify(plan);
    const normalizedFingerprint = roomPlanProjectionFingerprint(normalized);
    if (
      containedPlannerMetadata ||
      plan.projectionFingerprint !== normalizedFingerprint
    ) {
      colony.roomPlan = {
        ...plan,
        invalidatedAt: Game.time,
        invalidationReason: containedPlannerMetadata
          ? "published room plan retained planner-only score metadata"
          : "published room plan content drifted after projection fingerprinting",
      };
    }
  }
}
