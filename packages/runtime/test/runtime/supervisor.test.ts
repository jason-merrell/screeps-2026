import { describe, expect, it, vi } from "vitest";
import type { TickBudget } from "../../src/runtime/context";
import {
  createRuntimeSupervisorMemory,
  phasePercentiles,
  type RuntimePhaseName,
  RuntimeSupervisor,
  runtimeDeadline,
} from "../../src/runtime/supervisor";

const budget = (overrides: Partial<TickBudget> = {}): TickBudget => ({
  limit: 20,
  bucket: 10_000,
  used: 0,
  mode: "normal",
  ...overrides,
});

describe("runtime deadline", () => {
  it.each([1, 10, 50])(
    "retains explicit headroom at a %i CPU limit",
    (limit) => {
      const normal = runtimeDeadline(budget({ limit, mode: "normal" }));
      const critical = runtimeDeadline(
        budget({ limit, bucket: 500, mode: "critical" }),
      );

      expect(normal.headroom).toBeGreaterThan(0);
      expect(normal.deadline).toBeLessThan(limit);
      expect(critical.headroom).toBeGreaterThanOrEqual(normal.headroom);
      expect(critical.deadline).toBeLessThan(normal.deadline);
    },
  );
});

describe("runtime supervisor", () => {
  it("keeps survival work available after a planner failure", () => {
    let used = 0;
    const memory = createRuntimeSupervisorMemory();
    const supervisor = new RuntimeSupervisor({
      tick: 100,
      budget: budget(),
      memory,
      getUsed: () => used,
    });
    const afterFailure = vi.fn(() => {
      used += 0.4;
      return ["spawn-intent"];
    });

    expect(
      supervisor.run(
        "defense",
        () => {
          used += 0.2;
          throw new Error("injected defense failure");
        },
        () => [],
      ),
    ).toEqual([]);
    expect(supervisor.run("spawning", afterFailure, () => [])).toEqual([
      "spawn-intent",
    ]);

    expect(afterFailure).toHaveBeenCalledOnce();
    expect(supervisor.trace().phases).toMatchObject([
      { name: "defense", status: "failed" },
      { name: "spawning", status: "completed" },
    ]);
    expect(memory.phases.defense).toMatchObject({
      failures: 1,
      consecutiveFailures: 1,
      lastFailureTick: 100,
    });
  });

  it.each<RuntimePhaseName>(["defense", "spawning", "construction", "economy"])(
    "contains an injected %s planner exception",
    (name) => {
      const supervisor = new RuntimeSupervisor({
        tick: name === "construction" ? 47 : 1,
        budget: budget(),
        memory: createRuntimeSupervisorMemory(),
        getUsed: () => 0,
      });
      if (name === "construction") {
        for (const phase of ["defense", "spawning", "economy"] as const) {
          supervisor.run(phase, () => [], () => []);
        }
      }

      expect(
        supervisor.run(
          name,
          () => {
            throw new Error(`injected ${name} failure`);
          },
          () => ["safe-fallback"],
        ),
      ).toEqual(["safe-fallback"]);
      expect(supervisor.trace().phases.at(-1)).toMatchObject({
        name,
        status: "failed",
        error: `Error: injected ${name} failure`,
      });
    },
  );

  it("defers optional work at critical cadence but never defers survival lanes", () => {
    const memory = createRuntimeSupervisorMemory();
    const optional = vi.fn(() => ["optional"]);
    const survival = vi.fn(() => ["survival"]);
    const supervisor = new RuntimeSupervisor({
      tick: 12,
      budget: budget({ bucket: 500, mode: "critical" }),
      memory,
      getUsed: () => 100,
    });

    expect(supervisor.run("construction", optional, () => [])).toEqual([]);
    expect(supervisor.run("defense", survival, () => [])).toEqual(["survival"]);
    expect(optional).not.toHaveBeenCalled();
    expect(survival).toHaveBeenCalledOnce();
    expect(supervisor.trace().phases).toMatchObject([
      { name: "construction", status: "skipped", skipReason: "cadence" },
      { name: "defense", status: "completed", skipReason: null },
    ]);
  });

  it("rejects optional work before it can consume the rolling mandatory reserve", () => {
    const operation = vi.fn(() => ["construction"]);
    const supervisor = new RuntimeSupervisor({
      tick: 12,
      budget: budget(),
      memory: createRuntimeSupervisorMemory(),
      getUsed: () => 19,
    });

    expect(supervisor.run("construction", operation, () => [])).toEqual([]);
    expect(operation).not.toHaveBeenCalled();
    expect(supervisor.trace().phases.at(-1)).toMatchObject({
      status: "skipped",
      skipReason: "admission",
      admissionProjected: expect.any(Number),
    });
    expect(
      supervisor.trace().phases.at(-1)?.admissionProjected ?? 0,
    ).toBeGreaterThan(supervisor.trace().deadline);
  });

  it("runs a deferrable phase at its bounded cadence even after prior skips", () => {
    const memory = createRuntimeSupervisorMemory();
    memory.phases.construction = {
      runs: 1,
      failures: 0,
      skips: 49,
      lastRunTick: 100,
      lastCompletedTick: 100,
      consecutiveFailures: 0,
      cpuSamples: [0.5],
    };
    const operation = vi.fn(() => ["construction"]);
    const supervisor = new RuntimeSupervisor({
      tick: 150,
      budget: budget({ bucket: 500, mode: "critical" }),
      memory,
      getUsed: () => 0,
    });

    for (const phase of ["defense", "spawning", "economy"] as const) {
      supervisor.run(phase, () => [], () => []);
    }

    expect(supervisor.run("construction", operation, () => [])).toEqual([
      "construction",
    ]);
    expect(operation).toHaveBeenCalledOnce();
  });

  it("uses rolling p95 admission rather than treating budgets as labels", () => {
    const memory = createRuntimeSupervisorMemory();
    memory.phases.construction = {
      runs: 5,
      failures: 0,
      skips: 0,
      lastRunTick: 99,
      lastCompletedTick: 99,
      consecutiveFailures: 0,
      cpuSamples: [0.2, 0.2, 0.3, 0.3, 8],
    };
    let used = 0;
    const supervisor = new RuntimeSupervisor({
      tick: 100,
      budget: budget(),
      memory,
      getUsed: () => used,
    });
    for (const phase of ["defense", "spawning", "economy"] as const) {
      supervisor.run(phase, () => [], () => []);
    }
    used = 1;
    const operation = vi.fn(() => ["construction"]);

    expect(supervisor.run("construction", operation, () => [])).toEqual([]);
    expect(operation).not.toHaveBeenCalled();
    expect(supervisor.trace().phases.at(-1)).toMatchObject({
      name: "construction",
      status: "skipped",
      skipReason: "admission",
      admissionEstimate: 8,
    });
  });

  it("preserves survival ordering under cumulative CPU pressure", () => {
    let used = 0;
    const supervisor = new RuntimeSupervisor({
      tick: 100,
      budget: budget(),
      memory: createRuntimeSupervisorMemory(),
      getUsed: () => used,
      scopeUnits: 4,
    });
    const runCost = (value: string, cpu: number) => () => {
      used += cpu;
      return [value];
    };

    expect(supervisor.run("defense", runCost("defense", 3), () => [])).toEqual([
      "defense",
    ]);
    expect(supervisor.run("spawning", runCost("spawn", 3), () => [])).toEqual([
      "spawn",
    ]);
    expect(supervisor.run("economy", runCost("economy", 3), () => [])).toEqual([
      "economy",
    ]);
    const optional = vi.fn(runCost("optional", 4));
    expect(supervisor.run("construction", optional, () => [])).toEqual([]);
    expect(optional).not.toHaveBeenCalled();

    for (const phase of [
      "fspm_maintenance",
      "fspm_authority",
      "arbitration",
      "execution",
      "activity_evidence",
    ] as const) {
      expect(supervisor.run(phase, runCost(phase, 1), () => [])).toEqual([
        phase,
      ]);
    }
    expect(used).toBe(14);
    expect(
      supervisor.trace().phases.filter((phase) => phase.status === "skipped"),
    ).toEqual([
      expect.objectContaining({
        name: "construction",
        skipReason: "admission",
      }),
    ]);
  });

  it("adds a conservative reserve as colony scope grows", () => {
    const make = (scopeUnits: number) => {
      let used = 5.6;
      const supervisor = new RuntimeSupervisor({
        tick: 100,
        budget: budget(),
        memory: createRuntimeSupervisorMemory(),
        getUsed: () => used,
        scopeUnits,
      });
      for (const phase of ["defense", "spawning", "economy"] as const) {
        supervisor.run(phase, () => [], () => []);
      }
      const operation = vi.fn(() => {
        used += 0.5;
        return ["settlement"];
      });
      return { supervisor, operation };
    };
    const single = make(1);
    const empire = make(8);

    expect(single.supervisor.run("settlement", single.operation, () => [])).toEqual([
      "settlement",
    ]);
    expect(empire.supervisor.run("settlement", empire.operation, () => [])).toEqual(
      [],
    );
    expect(single.supervisor.trace().scopeUnits).toBe(1);
    expect(empire.supervisor.trace().scopeUnits).toBe(8);
  });

  it("orders overdue deferrable lanes by persisted debt to avoid starvation", () => {
    const memory = createRuntimeSupervisorMemory();
    memory.phases.settlement = {
      runs: 2,
      failures: 0,
      skips: 0,
      lastRunTick: 140,
      lastCompletedTick: 140,
      consecutiveFailures: 0,
      cpuSamples: [0.1],
    };
    memory.phases.construction = {
      runs: 2,
      failures: 0,
      skips: 20,
      lastRunTick: 100,
      lastCompletedTick: 100,
      consecutiveFailures: 0,
      cpuSamples: [0.1],
    };
    const supervisor = new RuntimeSupervisor({
      tick: 150,
      budget: budget({ mode: "constrained" }),
      memory,
      getUsed: () => 0,
    });

    expect(
      supervisor.orderDeferrable(["settlement", "construction"]),
    ).toEqual(["construction", "settlement"]);
  });

  it("always gives a never-run deferrable lane priority over finite debt", () => {
    const memory = createRuntimeSupervisorMemory();
    memory.phases.settlement = {
      runs: 1,
      failures: 0,
      skips: 0,
      lastRunTick: 149,
      lastCompletedTick: 149,
      consecutiveFailures: 0,
      cpuSamples: [0.1],
    };
    const supervisor = new RuntimeSupervisor({
      tick: 150,
      budget: budget(),
      memory,
      getUsed: () => 0,
    });

    expect(
      supervisor.orderDeferrable(["settlement", "construction"]),
    ).toEqual(["construction", "settlement"]);
  });

  it("exports bounded nearest-rank CPU percentiles", () => {
    expect(phasePercentiles([1, 2, 3, 4, 100])).toEqual({
      samples: 5,
      p50: 3,
      p95: 100,
      p99: 100,
    });
    expect(phasePercentiles([])).toEqual({
      samples: 0,
      p50: null,
      p95: null,
      p99: null,
    });
  });

  it("bounds persisted CPU samples and clears a prior failure on recovery", () => {
    let used = 0;
    const memory = createRuntimeSupervisorMemory();
    const failed = new RuntimeSupervisor({
      tick: 1,
      budget: budget(),
      memory,
      getUsed: () => used,
    });
    failed.run(
      "defense",
      () => {
        throw new Error("transient");
      },
      () => [],
    );

    for (let tick = 2; tick <= 140; tick += 1) {
      const recovered = new RuntimeSupervisor({
        tick,
        budget: budget(),
        memory,
        getUsed: () => used,
      });
      recovered.run(
        "defense",
        () => {
          used += 0.01;
          return [];
        },
        () => [],
      );
    }

    expect(memory.phases.defense).toMatchObject({
      runs: 140,
      failures: 1,
      consecutiveFailures: 0,
      lastCompletedTick: 140,
    });
    expect(memory.phases.defense?.cpuSamples).toHaveLength(128);
  });
});
