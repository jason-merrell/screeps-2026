import type { Intent } from "./types";

export function arbitrate(intents: Intent[]): Intent[] {
  const winners = new Map<string, Intent>();

  for (const intent of intents) {
    const current = winners.get(intent.creepName);
    if (!current || intent.priority > current.priority) {
      winners.set(intent.creepName, intent);
    }
  }

  return [...winners.values()].sort((a, b) => b.priority - a.priority || a.creepName.localeCompare(b.creepName));
}
