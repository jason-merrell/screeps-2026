import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";

const BOOTSTRAP_BODY: BodyPartConstant[] = [WORK, CARRY, MOVE];

export function planSpawning(world: WorldSnapshot): Intent[] {
  if (world.creeps.length > 0) return [];

  const spawn = world.spawns.find((candidate) => !candidate.spawning);
  if (!spawn || spawn.room.energyAvailable < BODYPART_COST[WORK] + BODYPART_COST[CARRY] + BODYPART_COST[MOVE]) {
    return [];
  }

  return [{
    type: "spawn",
    spawnName: spawn.name,
    body: BOOTSTRAP_BODY,
    name: `worker-${world.tick}`,
    priority: 1000,
    reason: "bootstrap workforce",
  }];
}
