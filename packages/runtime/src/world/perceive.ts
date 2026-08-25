import { readTickBudget, type WorldSnapshot } from "../runtime/context";
import { buildSpatialIndex } from "./spatial-index";

export function perceive(): WorldSnapshot {
  const rooms = Object.values(Game.rooms).filter((room) => room.controller?.my);
  const creeps = Object.values(Game.creeps);
  const spawns = Object.values(Game.spawns);
  const spatial = buildSpatialIndex(rooms);

  for (const room of rooms) {
    Memory.colonies[room.name] ??= {
      roomName: room.name,
      discoveredAt: Game.time,
    };
  }

  return {
    tick: Game.time,
    rooms,
    creeps,
    spawns,
    spatial,
    budget: readTickBudget(),
  };
}
