import { installSpawnAdvisor } from "./debug/spawn-advisor";
import { arbitrate } from "./intents/arbitrate";
import { execute } from "./intents/execute";
import { migrateMemory } from "./memory/migrate";
import { planConstruction } from "./systems/construction/plan";
import { planDefense } from "./systems/defense/plan";
import { planEconomy } from "./systems/economy/plan";
import { planSpawning } from "./systems/spawning/plan";
import { perceive } from "./world/perceive";

installSpawnAdvisor();

export const loop = (): void => {
  migrateMemory();

  const world = perceive();
  const proposed = [
    ...planDefense(world),
    ...planSpawning(world),
    ...planConstruction(world),
    ...planEconomy(world),
  ];

  const accepted = arbitrate(proposed);
  execute(accepted);
};
