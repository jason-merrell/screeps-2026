import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";
import {
  bodyCost,
  desiredBootstrapWorkforce,
  generalistBodyForCapacity,
  replacementLeadTicks,
} from "./workforce";

export function planSpawning(world: WorldSnapshot): Intent[] {
  const intents: Intent[] = [];

  for (const room of world.rooms) {
    const controllerLevel = room.controller?.level ?? 1;
    const sourceCount = room.find(FIND_SOURCES).length;
    const constructionSiteCount = room.find(FIND_MY_CONSTRUCTION_SITES).length;
    const desired = desiredBootstrapWorkforce(
      controllerLevel,
      sourceCount,
      constructionSiteCount,
    );

    const roomCreeps = world.creeps.filter((creep) => creep.room.name === room.name);
    const idleSpawns = world.spawns.filter(
      (spawn) => spawn.room.name === room.name && !spawn.spawning,
    );

    for (const spawn of idleSpawns) {
      let body = generalistBodyForCapacity(room.energyCapacityAvailable);
      let lead = replacementLeadTicks(body);
      let viable = roomCreeps.filter(
        (creep) => creep.spawning || (creep.ticksToLive ?? CREEP_LIFE_TIME) > lead,
      ).length;

      if (viable >= desired) continue;

      if (room.energyAvailable < bodyCost(body)) {
        if (viable > 0 || room.energyAvailable < 200) continue;
        body = generalistBodyForCapacity(room.energyAvailable);
        lead = replacementLeadTicks(body);
        viable = roomCreeps.filter(
          (creep) => creep.spawning || (creep.ticksToLive ?? CREEP_LIFE_TIME) > lead,
        ).length;
        if (viable >= desired || room.energyAvailable < bodyCost(body)) continue;
      }

      intents.push({
        type: "spawn",
        spawnName: spawn.name,
        body,
        name: `worker-${room.name}-${world.tick}`,
        priority: viable === 0 ? 2000 : 1200,
        reason:
          viable === 0
            ? "emergency bootstrap workforce recovery"
            : `workforce demand ${viable}/${desired}`,
      });
    }
  }

  return intents;
}
