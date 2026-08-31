import { describe, expect, it } from "vitest";
import {
  bodyCost,
  CREEP_SERVICE_LIFETIME_TICKS,
  desiredBootstrapWorkforce,
  generalistBodyBudgetForDemand,
  generalistBodyForCapacity,
  generalistBodyForDemand,
  MAX_CREEP_BODY_PARTS,
  roadMoveParts,
  SOURCE_SUSTAINABLE_ENERGY_PER_TICK,
  simulateSourceProducerCycle,
  sourceProducerBodyForCapacity,
  transporterBodyForCapacity,
  transporterFleetForCarryDemand,
} from "../../src/systems/spawning/workforce";

function partCount(
  body: readonly BodyPartConstant[],
  part: BodyPartConstant,
): number {
  return body.filter((candidate) => candidate === part).length;
}

function expectLegalRoadBody(
  body: readonly BodyPartConstant[],
  capacity: number,
): void {
  const moveParts = partCount(body, "move");
  expect(body.length).toBeLessThanOrEqual(MAX_CREEP_BODY_PARTS);
  expect(bodyCost(body)).toBeLessThanOrEqual(capacity);
  expect(moveParts).toBe(roadMoveParts(body.length - moveParts));
}

describe("bootstrap workforce", () => {
  it("keeps enough generalists alive to avoid a one-creep colony", () => {
    expect(desiredBootstrapWorkforce(1, 2, 0)).toBe(3);
    expect(desiredBootstrapWorkforce(2, 2, 0)).toBe(4);
    expect(desiredBootstrapWorkforce(3, 2, 0)).toBe(5);
  });

  it("adds temporary construction capacity while infrastructure is pending", () => {
    expect(desiredBootstrapWorkforce(2, 2, 5)).toBe(5);
    expect(desiredBootstrapWorkforce(3, 2, 10)).toBe(6);
  });

  it("grows mature general capacity gradually and bounds construction pressure", () => {
    expect(desiredBootstrapWorkforce(4, 2, 0)).toBe(5);
    expect(desiredBootstrapWorkforce(5, 2, 0)).toBe(6);
    expect(desiredBootstrapWorkforce(7, 2, 0)).toBe(7);
    expect(desiredBootstrapWorkforce(8, 2, 0)).toBe(7);
    expect(desiredBootstrapWorkforce(8, 2, 1)).toBe(8);
    expect(desiredBootstrapWorkforce(8, 2, 11)).toBe(9);
    expect(desiredBootstrapWorkforce(8, 2, 21)).toBe(10);
    expect(desiredBootstrapWorkforce(8, 2, 100)).toBe(10);
  });

  it("scales generalist bodies with room energy capacity", () => {
    expect(generalistBodyForCapacity(300)).toEqual(["work", "carry", "move"]);
    expect(generalistBodyForCapacity(400)).toEqual([
      "work",
      "carry",
      "move",
      "work",
      "carry",
      "move",
    ]);
    expect(bodyCost(generalistBodyForCapacity(600))).toBe(600);
    expect(generalistBodyForCapacity(199)).toEqual([]);
  });

  it("scales mature generalists to the legal body boundary", () => {
    const body = generalistBodyForCapacity(12_900);

    expect(body).toHaveLength(48);
    expect(partCount(body, "work")).toBe(16);
    expect(partCount(body, "carry")).toBe(16);
    expect(partCount(body, "move")).toBe(16);
    expect(bodyCost(body)).toBe(3_200);
    expectLegalRoadBody(body, 12_900);
  });

  it("right-sizes the live mature fleet to sustainable source income", () => {
    const baselineCount = desiredBootstrapWorkforce(8, 2, 0);
    const surgeCount = desiredBootstrapWorkforce(8, 2, 21);
    const baselineBody = generalistBodyForDemand(12_900, 2, baselineCount);
    const surgeBody = generalistBodyForDemand(12_900, 2, surgeCount);

    expect(baselineBody).toHaveLength(18);
    expect(partCount(baselineBody, "work") * baselineCount).toBe(42);
    expect(surgeBody).toHaveLength(12);
    expect(partCount(surgeBody, "work") * surgeCount).toBe(40);
    expect(bodyCost(baselineBody) * baselineCount).toBe(8_400);
    expect(bodyCost(surgeBody) * surgeCount).toBe(8_000);
  });

  it("selects the strongest road-mobile source producer the room can fund", () => {
    expect(sourceProducerBodyForCapacity(550)).toEqual([
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
    ]);
    expect(bodyCost(sourceProducerBodyForCapacity(550))).toBe(550);
    expect(sourceProducerBodyForCapacity(199)).toEqual([]);
  });

  it("buffers an entire source regeneration cycle under one-intent arbitration", () => {
    const body = sourceProducerBodyForCapacity(900);
    expect(body).toEqual([
      "work",
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ]);
    expectLegalRoadBody(body, 900);

    const previousBootstrapBody = [
      "work",
      "work",
      "work",
      "work",
      "work",
      "carry",
      "move",
    ] as const;
    expect(simulateSourceProducerCycle(previousBootstrapBody)).toMatchObject({
      bufferedEnergy: 2_500,
      carriedEnergy: 0,
      harvestIntents: 250,
      transferIntents: 50,
    });
    expect(simulateSourceProducerCycle(body)).toEqual({
      bufferedEnergy: 3_000,
      carriedEnergy: 0,
      harvestedEnergy: 3_000,
      harvestIntents: 270,
      idleTicks: 0,
      remainingSourceEnergy: 0,
      transferIntents: 30,
      wastedHarvestCapacity: 240,
    });
  });

  it("concentrates transport into road-balanced CARRY capacity without WORK tax", () => {
    expect(transporterBodyForCapacity(550)).toEqual([
      "carry",
      "carry",
      "carry",
      "carry",
      "carry",
      "carry",
      "carry",
      "move",
      "move",
      "move",
      "move",
    ]);
    expect(bodyCost(transporterBodyForCapacity(550))).toBe(550);
    expect(transporterBodyForCapacity(550, 4)).toEqual([
      "carry",
      "carry",
      "carry",
      "carry",
      "move",
      "move",
    ]);
  });

  it("scales transport to the exact 50-part mobility boundary", () => {
    const body = transporterBodyForCapacity(12_900);

    expect(body).toHaveLength(50);
    expect(partCount(body, "carry")).toBe(33);
    expect(partCount(body, "move")).toBe(17);
    expect(bodyCost(body)).toBe(2_500);
    expectLegalRoadBody(body, 12_900);
  });

  it("keeps short and long-route complete workforce replacement within 40%", () => {
    const sourceCount = 2;
    const sustainableIncome = sourceCount * SOURCE_SUSTAINABLE_ENERGY_PER_TICK;
    const producerBody = sourceProducerBodyForCapacity(12_900);

    // Each transporter is bound to one live source route, so replacement cost
    // must preserve two independently assignable fleets rather than pooling
    // CARRY across sources. Six-WORK producers emit 12 energy/tick.
    for (const perSourceCarryDemand of [3, 20]) {
      const transportBodies = Array.from({ length: sourceCount }).flatMap(() =>
        transporterFleetForCarryDemand(12_900, perSourceCarryDemand),
      );
      const specializedReplacementEnergy =
        sourceCount * bodyCost(producerBody) +
        transportBodies.reduce((total, body) => total + bodyCost(body), 0);

      for (const constructionSites of [0, 21]) {
        const generalistCount = desiredBootstrapWorkforce(
          8,
          sourceCount,
          constructionSites,
        );
        const budget = generalistBodyBudgetForDemand(
          12_900,
          sourceCount,
          generalistCount,
          specializedReplacementEnergy,
        );
        const replacementEnergyPerTick =
          budget.recurringReplacementEnergy / CREEP_SERVICE_LIFETIME_TICKS;

        expect(budget.status).toBe("within-budget");
        expect(replacementEnergyPerTick).toBeLessThanOrEqual(
          sustainableIncome * 0.4,
        );
        expect(
          sustainableIncome - replacementEnergyPerTick,
        ).toBeGreaterThanOrEqual(12);
      }
    }
  });

  it("labels minimum survival when specialists exhaust the replacement budget", () => {
    const budget = generalistBodyBudgetForDemand(12_900, 2, 7, 12_000);

    expect(budget.body).toEqual(["work", "carry", "move"]);
    expect(budget.completeWorkforceReplacementBudget).toBe(12_000);
    expect(budget.recurringReplacementEnergy).toBe(13_400);
    expect(budget.status).toBe("minimum-survival-exception");
  });

  it("splits transport demand across legal road-mobile bodies", () => {
    const fleet = transporterFleetForCarryDemand(12_900, 34);

    expect(fleet.map((body) => partCount(body, "carry"))).toEqual([33, 1]);
    expect(fleet.flat()).toHaveLength(52);
    for (const body of fleet) expectLegalRoadBody(body, 12_900);
  });

  it("keeps every canonical RCL composition within cost, parts, and road mobility", () => {
    for (const capacity of [
      0, 149, 150, 199, 200, 300, 550, 800, 1_300, 1_800, 2_300, 5_600, 12_900,
    ]) {
      for (const body of [
        generalistBodyForCapacity(capacity),
        sourceProducerBodyForCapacity(capacity),
        transporterBodyForCapacity(capacity),
      ]) {
        expectLegalRoadBody(body, capacity);
      }
    }
  });
});
