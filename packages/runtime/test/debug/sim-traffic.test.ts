import { afterEach, describe, expect, it, vi } from "vitest";
import { runSimTrafficHarness } from "../../src/debug/sim-traffic";

describe("simulation traffic harness isolation", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deactivates stale Simulation state without preempting World boot", () => {
    vi.stubGlobal("Game", { time: 123, rooms: {}, creeps: {} });
    vi.stubGlobal("Memory", {
      simTraffic: {
        version: 1,
        active: true,
        scenario: "headOn",
        phase: "running",
        startedAt: 100,
        phaseStartedAt: 100,
        participants: [],
        metrics: {},
        lastMetrics: {},
        runningTicks: 23,
      },
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(runSimTrafficHarness()).toBe(false);
    expect(Memory.simTraffic).toMatchObject({
      active: false,
      phase: "failed",
      completedAt: 123,
      failure: "simTraffic can only run in the browser Simulation room",
    });
  });
});
