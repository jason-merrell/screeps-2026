import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { compareRuntimeTrials } from "./benchmark-lib.mjs";
import { runDiagnosticChild } from "./diagnostic-child.mjs";
import {
  benchmarkExitCode,
  scenarioExitCode,
  scenarioSuiteStatus,
} from "./verdict-policy.mjs";

const passingTrial = (runningTicks = 12) => ({
  name: "head-on",
  status: "passed",
  ticksObserved: 40,
  finalState: {
    phase: "complete",
    runningTicks,
    metrics: {
      pathFinds: 3,
      congestionRepaths: 1,
      stuckRequests: 0,
      fatigueWaits: 0,
    },
  },
  analysis: {
    nativeTileExchangeCount: 0,
    headOnPrimaryCreepsLeftHorizontalCorridor: false,
  },
});

const compare = (baselineTrials, candidateTrials) =>
  compareRuntimeTrials({
    baselineSha: "a".repeat(40),
    candidateSha: "b".repeat(40),
    fixtureVersion: "traffic-v1",
    tickBudget: 320,
    repetitions: 2,
    scenarioNames: ["head-on"],
    baselineTrials,
    candidateTrials,
  });

describe("private-server quality-gate policy", () => {
  it("fails closed for scenario failures, infrastructure failures, and unknown states", () => {
    expect(scenarioExitCode("passed")).toBe(0);
    expect(scenarioExitCode("failed")).toBe(1);
    expect(scenarioExitCode("infrastructure-failed")).toBe(1);
    expect(scenarioExitCode("unexpected")).toBe(1);
  });

  it("preserves the most diagnostic suite failure status", () => {
    expect(
      scenarioSuiteStatus([{ status: "passed" }, { status: "passed" }]),
    ).toBe("passed");
    expect(
      scenarioSuiteStatus([{ status: "passed" }, { status: "failed" }]),
    ).toBe("failed");
    expect(
      scenarioSuiteStatus([
        { status: "failed" },
        { status: "infrastructure-failed" },
      ]),
    ).toBe("infrastructure-failed");
    expect(
      scenarioSuiteStatus([{ status: "passed" }, { status: "unknown" }]),
    ).toBe("infrastructure-failed");
    expect(scenarioSuiteStatus([])).toBe("infrastructure-failed");
  });

  it("allows only valid non-regressing benchmark verdicts", () => {
    expect(benchmarkExitCode("equivalent")).toBe(0);
    expect(benchmarkExitCode("improved")).toBe(0);
    expect(benchmarkExitCode("regressed")).toBe(1);
    expect(benchmarkExitCode("invalid")).toBe(1);
    expect(benchmarkExitCode("unexpected")).toBe(1);
  });

  it("blocks a guarded metric regression produced by the comparison engine", () => {
    const baseline = [passingTrial(), passingTrial()];
    const slower = passingTrial(13);
    const comparison = compare(baseline, [slower, structuredClone(slower)]);

    expect(comparison.verdict).toBe("regressed");
    expect(comparison.comparisons["head-on"].regression).toBe(true);
    expect(benchmarkExitCode(comparison.verdict)).toBe(1);
  });

  it("blocks an invalid comparison even when both sides fail identically", () => {
    const failed = {
      ...passingTrial(),
      status: "infrastructure-failed",
      finalState: null,
    };
    const comparison = compare(
      [failed, structuredClone(failed)],
      [structuredClone(failed), structuredClone(failed)],
    );

    expect(comparison.verdict).toBe("invalid");
    expect(benchmarkExitCode(comparison.verdict)).toBe(1);
  });

  it("retains a failed child result and records its nonzero exit", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "screeps-gate-"));
    const resultPath = path.join(tempDir, "result.json");
    await writeFile(
      resultPath,
      `${JSON.stringify({ name: "head-on", status: "failed", assertions: [] })}\n`,
      "utf8",
    );

    try {
      const result = await runDiagnosticChild({
        execFileAsync: async () => {
          throw Object.assign(new Error("child failed"), {
            code: 1,
            stdout: "",
            stderr: "",
          });
        },
        file: process.execPath,
        args: [],
        options: {},
        resultPath,
        resultName: "head-on",
      });

      expect(result.status).toBe("failed");
      expect(result.runnerFailure).toMatchObject({
        exitCode: 1,
        message: "child failed",
      });
      expect(JSON.parse(await readFile(resultPath, "utf8"))).toEqual(result);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("converts an impossible pass-plus-nonzero-exit into infrastructure failure", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "screeps-gate-"));
    const resultPath = path.join(tempDir, "result.json");
    await writeFile(
      resultPath,
      `${JSON.stringify({ name: "bootstrap", status: "passed" })}\n`,
      "utf8",
    );

    try {
      const result = await runDiagnosticChild({
        execFileAsync: async () => {
          throw Object.assign(new Error("native process crashed"), {
            code: 9,
            stdout: "",
            stderr: "",
          });
        },
        file: process.execPath,
        args: [],
        options: {},
        resultPath,
        resultName: "bootstrap",
      });

      expect(result.status).toBe("infrastructure-failed");
      expect(result.error).toContain("after reporting a pass");
      expect(result.runnerFailure.exitCode).toBe(9);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
