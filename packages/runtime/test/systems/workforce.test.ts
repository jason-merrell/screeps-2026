import { describe, expect, it } from "vitest";
import {
  bodyCost,
  desiredBootstrapWorkforce,
  generalistBodyForCapacity,
  sourceProducerBodyForCapacity,
  transporterBodyForCapacity,
} from "../../src/systems/spawning/workforce";

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
  });

  it("concentrates source production into WORK-heavy bodies", () => {
    expect(sourceProducerBodyForCapacity(550)).toEqual([
      "work",
      "work",
      "work",
      "work",
      "carry",
      "move",
    ]);
    expect(bodyCost(sourceProducerBodyForCapacity(550))).toBe(500);
  });

  it("concentrates transport into CARRY/MOVE bodies without WORK tax", () => {
    expect(transporterBodyForCapacity(550)).toEqual([
      "carry",
      "move",
      "carry",
      "move",
      "carry",
      "move",
      "carry",
      "move",
      "carry",
      "move",
    ]);
    expect(bodyCost(transporterBodyForCapacity(550))).toBe(500);
  });
});
