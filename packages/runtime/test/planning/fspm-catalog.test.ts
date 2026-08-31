import { beforeEach, describe, expect, it } from "vitest";
import {
  FSPM_GOVERNANCE_SHA,
  FSPM_TASK_CATALOG,
  requireFspmTaskDefinition,
  validateFspmTaskCatalog,
} from "../../src/planning/fspm-catalog";
import {
  activateApprovedColonyGovernance,
  ensureColonyPortfolio,
  ensureProcedure,
  ensureTask,
} from "../../src/planning/fspm";

function installGlobals(): void {
  Object.assign(globalThis, {
    Game: { time: 100 },
    Memory: {
      version: 5,
      colonies: {
        W1N1: {
          roomName: "W1N1",
          discoveredAt: 1,
        },
      },
    },
  });
}

describe("canonical FSPM Task catalog", () => {
  beforeEach(() => {
    installGlobals();
    activateApprovedColonyGovernance("W1N1");
  });

  it("passes the governed conformance gate", () => {
    expect(FSPM_GOVERNANCE_SHA).toBe(
      "02d581886a759d19044ff91a80d743fa042f23f7",
    );
    expect(FSPM_TASK_CATALOG).toHaveLength(6);
    expect(validateFspmTaskCatalog()).toEqual([]);
  });

  it("deep-freezes every execution-authorizing catalog definition", () => {
    expect(Object.isFrozen(FSPM_TASK_CATALOG)).toBe(true);
    for (const task of FSPM_TASK_CATALOG) {
      expect(Object.isFrozen(task)).toBe(true);
      expect(Object.isFrozen(task.kpiMetric)).toBe(true);
      expect(Object.isFrozen(task.determination)).toBe(true);
      expect(Object.isFrozen(task.procedures)).toBe(true);
      for (const procedure of task.procedures) {
        expect(Object.isFrozen(procedure)).toBe(true);
        expect(Object.isFrozen(procedure.allowedIntentTypes)).toBe(true);
      }
    }
  });

  it("materializes catalog quality, weight, determination, and Procedures", () => {
    const task = ensureTask(
      "W1N1",
      "economy",
      "maintain-colony-energy-service",
    );
    const definition = requireFspmTaskDefinition(
      "economy",
      "maintain-colony-energy-service",
    );

    expect(task).toMatchObject({
      title: definition.title,
      description: definition.description,
      taskWeight: 65,
      qualityDescription: definition.qualityDescription,
      qualityMetric: definition.qualityMetric,
      determination: {
        outputIndependence: "independent",
        independentlyMeasurable: true,
        governanceSha: FSPM_GOVERNANCE_SHA,
      },
    });
    expect(task.procedures.map((procedure) => procedure.procedureKey)).toEqual(
      definition.procedures.map((procedure) => procedure.key),
    );
    expect(ensureColonyPortfolio("W1N1").tasks[task.id]).toBe(task);
  });

  it("fails closed for unreviewed Tasks and Procedures", () => {
    expect(() =>
      ensureTask("W1N1", "economy", "harvest-something-clever"),
    ).toThrow(/must pass the governed Task-or-Procedure determination/);
    expect(() =>
      ensureProcedure(
        "W1N1",
        "economy",
        "maintain-colony-energy-service",
        "teleport-energy",
      ),
    ).toThrow(
      /Procedure definitions are governed by the canonical Task catalog/,
    );
  });
});
