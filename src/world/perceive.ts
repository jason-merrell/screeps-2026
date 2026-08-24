import { readTickBudget, type WorldSnapshot } from "../runtime/context";

export function perceive(): WorldSnapshot {
  const rooms = Object.values(Game.rooms).filter((room) => room.controller?.my);
  const creeps = Object.values(Game.creeps);
  const spawns = Object.values(Game.spawns);

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
    budget: readTickBudget(),
  };
}
