import { ensureDomainHierarchy } from "./fspm";

export function ensureRoomPlanOwnership(): void {
  for (const [roomName, colony] of Object.entries(Memory.colonies)) {
    const plan = colony.roomPlan;
    if (!plan) continue;

    const { deliverable } = ensureDomainHierarchy(roomName, "construction");
    const expectedPlanId = `plan:${roomName}:construction:room-plan:v${plan.version}`;

    if (plan.planId !== expectedPlanId) plan.planId = expectedPlanId;
    if (plan.deliverableId !== deliverable.id) plan.deliverableId = deliverable.id;
  }
}
