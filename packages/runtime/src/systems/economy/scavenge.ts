import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";
import { capabilitiesOf } from "../../workforce/capabilities";

const SALVAGE_PRIORITY = 1020;

export function planScavenging(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const creep of world.creeps) {
    if (creep.spawning || !capabilitiesOf(creep).has("haul")) continue;

    const energy = creep.store.getUsedCapacity(RESOURCE_ENERGY);
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY) ?? energy;
    if (capacity <= 0 || energy >= capacity) continue;
    if (creep.memory.energyMode === "deliver" && energy > 0) continue;

    const spatial = world.spatial.byRoom[creep.room.name];
    if (!spatial) continue;

    const target = world.spatial.nearest(
      creep.pos,
      spatial.salvage.filter(
        (candidate) => candidate.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
      ),
    );
    if (!target) continue;

    intents.push({
      type: "withdraw",
      creepName: creep.name,
      targetId: target.id,
      resource: RESOURCE_ENERGY,
      priority: SALVAGE_PRIORITY,
      reason: "recover already-extracted energy before mining a fresh source",
      trace: createIntentTrace({
        roomName: creep.room.name,
        domain: "economy",
        task: "maintain-colony-energy-service",
        procedure: "recover-salvage-energy",
      }),
    });
  }

  return intents;
}
