export const GENERALIST_UNIT_COST = 200;

export function desiredBootstrapWorkforce(
  controllerLevel: number,
  sourceCount: number,
  constructionSiteCount: number,
): number {
  const base =
    controllerLevel <= 1
      ? Math.max(3, sourceCount + 1)
      : controllerLevel === 2
        ? Math.max(4, sourceCount + 2)
        : Math.max(5, sourceCount + 3);

  return Math.min(7, base + (constructionSiteCount > 0 ? 1 : 0));
}

export function generalistBodyForCapacity(capacity: number): BodyPartConstant[] {
  const units = Math.max(1, Math.min(3, Math.floor(capacity / GENERALIST_UNIT_COST)));
  const body: BodyPartConstant[] = [];

  for (let index = 0; index < units; index += 1) {
    body.push("work", "carry", "move");
  }

  return body;
}

export function sourceProducerBodyForCapacity(capacity: number): BodyPartConstant[] {
  if (capacity < GENERALIST_UNIT_COST) return generalistBodyForCapacity(capacity);

  const workParts = Math.max(1, Math.min(5, Math.floor((capacity - 100) / 100)));
  return [
    ...Array.from({ length: workParts }, () => "work" as const),
    "carry",
    "move",
  ];
}

export function transporterBodyForCapacity(capacity: number): BodyPartConstant[] {
  const pairs = Math.max(1, Math.min(12, Math.floor(capacity / 100)));
  const body: BodyPartConstant[] = [];
  for (let index = 0; index < pairs; index += 1) {
    body.push("carry", "move");
  }
  return body;
}

export function bodyCost(body: BodyPartConstant[]): number {
  const costs: Record<BodyPartConstant, number> = {
    move: 50,
    work: 100,
    carry: 50,
    attack: 80,
    ranged_attack: 150,
    heal: 250,
    claim: 600,
    tough: 10,
  };

  return body.reduce((total, part) => total + costs[part], 0);
}

export function replacementLeadTicks(body: BodyPartConstant[]): number {
  return body.length * CREEP_SPAWN_TIME + 25;
}
