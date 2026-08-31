import { ensureDomainHierarchy } from "./fspm";
import { usableRoomPlanProjection } from "./room-plan-projection";

export function ensureRoomPlanOwnership(): void {
  for (const [roomName, colony] of Object.entries(Memory.colonies)) {
    const projection = usableRoomPlanProjection(colony, roomName);
    const retainedPlan = colony.roomPlan;
    if (!projection.usable || !retainedPlan) continue;

    const { deliverable } = ensureDomainHierarchy(roomName, "construction");
    // RoomPlan is a mutable operational projection, not an authoritative FSPM
    // record. These identifiers provide execution traceability to the governed
    // construction Deliverable; authority remains in the Portfolio ledgers.
    const expectedPlanId = `plan:${roomName}:construction:room-plan:v${retainedPlan.version}`;

    if (
      retainedPlan.planId !== expectedPlanId ||
      retainedPlan.deliverableId !== deliverable.id
    ) {
      colony.roomPlan = {
        ...retainedPlan,
        planId: expectedPlanId,
        deliverableId: deliverable.id,
      };
    }
  }
}
