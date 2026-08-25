import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";
import {
  plannedSourceRouteLength,
  requiredCarryParts,
} from "../economy/logistics";
import {
  bodyCost,
  desiredBootstrapWorkforce,
  generalistBodyForCapacity,
  replacementLeadTicks,
  sourceProducerBodyForCapacity,
  transporterBodyForCapacity,
} from "./workforce";

interface LogisticsSpawnNeed {
  body: BodyPartConstant[];
  task: string;
  namePrefix: string;
  priority: number;
  reason: string;
}

function liveSourceBufferIndices(room: Room): number[] {
  const plan = Memory.colonies[room.name]?.roomPlan;
  if (!plan) return [];

  const live: number[] = [];
  for (const [index, anchor] of plan.anchors.sources.entries()) {
    const hasContainer = room
      .lookForAt(LOOK_STRUCTURES, anchor.container.x, anchor.container.y)
      .some((structure) => structure.structureType === STRUCTURE_CONTAINER);
    if (hasContainer) live.push(index);
  }
  return live;
}

function activeParts(creep: Creep, part: BodyPartConstant): number {
  return creep.getActiveBodyparts(part);
}

function logisticsSpawnNeed(room: Room, roomCreeps: Creep[]): LogisticsSpawnNeed | null {
  const plan = Memory.colonies[room.name]?.roomPlan;
  if (!plan) return null;

  const bufferIndices = liveSourceBufferIndices(room);
  if (bufferIndices.length === 0) return null;

  const producerBody = sourceProducerBodyForCapacity(room.energyCapacityAvailable);
  const producerLead = replacementLeadTicks(producerBody);
  const targetProducerWork = producerBody.filter((part) => part === WORK).length;
  const producerCandidates = roomCreeps
    .filter(
      (creep) =>
        !creep.spawning &&
        (creep.ticksToLive ?? CREEP_LIFE_TIME) > producerLead &&
        activeParts(creep, WORK) >= targetProducerWork,
    )
    .sort(
      (a, b) =>
        activeParts(b, WORK) - activeParts(a, WORK) || a.name.localeCompare(b.name),
    );

  if (producerCandidates.length < bufferIndices.length) {
    return {
      body: producerBody,
      task: "staff-source-production",
      namePrefix: "producer",
      priority: 1500,
      reason: `source production coverage ${producerCandidates.length}/${bufferIndices.length}`,
    };
  }

  const reservedProducers = new Set(
    producerCandidates.slice(0, bufferIndices.length).map((creep) => creep.name),
  );
  const requiredCarry = bufferIndices.reduce(
    (total, sourceIndex) =>
      total + requiredCarryParts(plannedSourceRouteLength(plan, sourceIndex)),
    0,
  );
  const transporterBody = transporterBodyForCapacity(room.energyCapacityAvailable);
  const transporterLead = replacementLeadTicks(transporterBody);
  const availableCarry = roomCreeps
    .filter(
      (creep) =>
        !creep.spawning &&
        !reservedProducers.has(creep.name) &&
        (creep.ticksToLive ?? CREEP_LIFE_TIME) > transporterLead,
    )
    .reduce((total, creep) => total + activeParts(creep, CARRY), 0);

  if (availableCarry < requiredCarry) {
    return {
      body: transporterBody,
      task: "close-transport-throughput-gap",
      namePrefix: "transport",
      priority: 1400,
      reason: `transport throughput ${availableCarry}/${requiredCarry} CARRY parts`,
    };
  }

  return null;
}

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

      if (viable === 0) {
        if (room.energyAvailable < bodyCost(body)) {
          if (room.energyAvailable < 200) continue;
          body = generalistBodyForCapacity(room.energyAvailable);
        }
        if (room.energyAvailable < bodyCost(body)) continue;

        intents.push({
          type: "spawn",
          spawnName: spawn.name,
          body,
          name: `worker-${room.name}-${world.tick}`,
          priority: 2000,
          reason: "emergency bootstrap workforce recovery",
          trace: createIntentTrace({
            roomName: room.name,
            domain: "spawning",
            task: "recover-workforce",
            activity: `${spawn.name}:spawn-worker`,
          }),
        });
        continue;
      }

      const logisticsNeed = logisticsSpawnNeed(room, roomCreeps);
      if (logisticsNeed) {
        if (room.energyAvailable < bodyCost(logisticsNeed.body)) continue;
        intents.push({
          type: "spawn",
          spawnName: spawn.name,
          body: logisticsNeed.body,
          name: `${logisticsNeed.namePrefix}-${room.name}-${world.tick}`,
          priority: logisticsNeed.priority,
          reason: logisticsNeed.reason,
          trace: createIntentTrace({
            roomName: room.name,
            domain: "spawning",
            task: logisticsNeed.task,
            activity: `${spawn.name}:spawn-${logisticsNeed.namePrefix}`,
          }),
        });
        continue;
      }

      if (viable >= desired) continue;

      if (room.energyAvailable < bodyCost(body)) {
        if (room.energyAvailable < 200) continue;
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
        priority: 1200,
        reason: `workforce demand ${viable}/${desired}`,
        trace: createIntentTrace({
          roomName: room.name,
          domain: "spawning",
          task: "maintain-workforce",
          activity: `${spawn.name}:spawn-worker`,
        }),
      });
    }
  }

  return intents;
}
