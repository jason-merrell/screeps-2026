import { arbitrate } from "./intents/arbitrate";
import { execute } from "./intents/execute";
import { migrateMemory } from "./memory/migrate";
import { planEconomy } from "./systems/economy/plan";
import { planSpawning } from "./systems/spawning/plan";
import { perceive } from "./world/perceive";

export const loop = (): void => {
  migrateMemory();

  const world = perceive();
  const proposed = [
    ...planSpawning(world),
    ...planEconomy(world),
  ];

  const accepted = arbitrate(proposed);
  execute(accepted);
};
