import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { WorldSnapshot } from "../../runtime/context";
import { capabilitiesOf } from "../../workforce/capabilities";
import { shouldActivateSourceBuffers } from "./logistics";

interface BufferedSource {
  source: Source;
  container: StructureContainer;
}

function energyTrace(
  roomName: string,
  procedure: "withdraw-buffered-energy" | "stage-source-transport",
) {
  return createIntentTrace({
    roomName,
    domain: "economy",
    task: "maintain-colony-energy-service",
    procedure,
  });
}

function creepAssignee(intent: Intent): string | undefined {
  return "creepName" in intent ? intent.creepName : undefined;
}

function bufferedSources(room: Room): BufferedSource[] {
  const plan = Memory.colonies[room.name]?.roomPlan;
  if (!plan) return [];

  const controllerLevel = room.controller?.level ?? 0;
  const workforceCount = room.find(FIND_MY_CREEPS).length;
  if (
    !shouldActivateSourceBuffers(
      controllerLevel,
      workforceCount,
      plan.anchors.sources.length,
    )
  ) {
    return [];
  }

  const buffered: BufferedSource[] = [];
  for (const anchor of plan.anchors.sources) {
    const source = Game.getObjectById(anchor.sourceId as Id<Source>);
    if (!source) continue;

    const container = room
      .lookForAt(LOOK_STRUCTURES, anchor.container.x, anchor.container.y)
      .find(
        (structure): structure is StructureContainer =>
          structure.structureType === STRUCTURE_CONTAINER,
      );
    if (container) buffered.push({ source, container });
  }
  return buffered;
}

function compareByRangeThenId(
  creep: Creep,
  left: BufferedSource,
  right: BufferedSource,
): number {
  const rangeDelta = creep.pos.getRangeTo(left.container) - creep.pos.getRangeTo(right.container);
  if (rangeDelta !== 0) return rangeDelta;
  return String(left.container.id).localeCompare(String(right.container.id));
}

/**
 * Last-resort economy policy for otherwise-unassigned hybrid WORK+CARRY labor.
 *
 * Primary producer/transport reservations and source-buffer activation remain
 * authoritative. This planner only acts when the ordinary economy planner
 * produced no creep intent at all. It turns usable buffered energy into governed
 * work, or explicitly stages the performer near a source buffer instead of
 * allowing silent planner fallthrough.
 */
export function planSurplusLaborUtilization(
  world: WorldSnapshot,
  primaryEconomyIntents: Intent[],
): Intent[] {
  const assigned = new Set(
    primaryEconomyIntents
      .map(creepAssignee)
      .filter((name): name is string => name !== undefined),
  );
  const buffersByRoom = new Map(
    world.rooms.map((room) => [room.name, bufferedSources(room)] as const),
  );
  const intents: Intent[] = [];

  for (const creep of [...world.creeps].sort((left, right) => left.name.localeCompare(right.name))) {
    if (creep.spawning || assigned.has(creep.name)) continue;

    const capabilities = capabilitiesOf(creep);
    if (!capabilities.has("harvest") || !capabilities.has("haul")) continue;
    if (creep.store.getUsedCapacity(RESOURCE_ENERGY) > 0) continue;

    const buffers = [...(buffersByRoom.get(creep.room.name) ?? [])].sort((left, right) =>
      compareByRangeThenId(creep, left, right),
    );
    if (buffers.length === 0) continue;

    const available = buffers.find(
      (node) => node.container.store.getUsedCapacity(RESOURCE_ENERGY) > 0,
    );
    if (available) {
      intents.push({
        type: "withdraw",
        creepName: creep.name,
        targetId: available.container.id,
        resource: RESOURCE_ENERGY,
        priority: 300,
        reason:
          "use otherwise-surplus hybrid labor to recover available buffered energy for governed downstream work",
        trace: energyTrace(creep.room.name, "withdraw-buffered-energy"),
      });
      continue;
    }

    const stagingTarget =
      buffers.find((node) => node.source.energy > 0) ?? buffers[0];
    if (!stagingTarget) continue;
    intents.push({
      type: "move",
      creepName: creep.name,
      targetId: stagingTarget.container.id,
      range: 2,
      priority: 150,
      reason:
        "stage otherwise-surplus hybrid labor near a source buffer while awaiting usable energy",
      trace: energyTrace(creep.room.name, "stage-source-transport"),
    });
  }

  return intents;
}
