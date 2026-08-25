import type { Intent } from "./types";

export interface ArbitrationRejection {
  conflictKey: string;
  winner: Intent;
  loser: Intent;
}

export interface ArbitrationResult {
  accepted: Intent[];
  rejected: ArbitrationRejection[];
}

export function conflictKey(intent: Intent): string {
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

export function arbitrateDetailed(intents: Intent[]): ArbitrationResult {
  const winners = new Map<string, Intent>();

  for (const intent of intents) {
    const key = conflictKey(intent);
    const current = winners.get(key);
    if (!current || intent.priority > current.priority) {
      winners.set(key, intent);
    }
  }

  const accepted = [...winners.values()].sort((a, b) => {
    const priority = b.priority - a.priority;
    if (priority !== 0) return priority;
    return conflictKey(a).localeCompare(conflictKey(b));
  });

  const rejected: ArbitrationRejection[] = [];
  for (const intent of intents) {
    const key = conflictKey(intent);
    const winner = winners.get(key);
    if (winner && winner !== intent) {
      rejected.push({ conflictKey: key, winner, loser: intent });
    }
  }

  return { accepted, rejected };
}

export function arbitrate(intents: Intent[]): Intent[] {
  return arbitrateDetailed(intents).accepted;
}
