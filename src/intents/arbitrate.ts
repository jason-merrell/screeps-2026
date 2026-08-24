import type { Intent } from "./types";

function conflictKey(intent: Intent): string {
  switch (intent.type) {
    case "spawn":
      return `spawn:${intent.spawnName}`;
    case "createConstructionSite":
      return `site:${intent.roomName}:${intent.x}:${intent.y}`;
    case "towerAttack":
      return `tower:${intent.towerId}`;
    default:
      return `creep:${intent.creepName}`;
  }
}

export function arbitrate(intents: Intent[]): Intent[] {
  const winners = new Map<string, Intent>();

  for (const intent of intents) {
    const key = conflictKey(intent);
    const current = winners.get(key);
    if (!current || intent.priority > current.priority) {
      winners.set(key, intent);
    }
  }

  return [...winners.values()].sort((a, b) => {
    const priority = b.priority - a.priority;
    if (priority !== 0) return priority;
    return conflictKey(a).localeCompare(conflictKey(b));
  });
}
