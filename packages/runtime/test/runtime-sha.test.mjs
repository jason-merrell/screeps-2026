import { describe, expect, it, vi } from "vitest";
import { resolveProofRuntimeSha } from "../../../scripts/lib/runtime-sha.mjs";

const SHA = "a".repeat(40);

describe("production proof runtime SHA", () => {
  it("accepts an explicit immutable candidate SHA without consulting Git", () => {
    const runGit = vi.fn();
    expect(
      resolveProofRuntimeSha({
        environment: { SCREEPS_RUNTIME_SHA: SHA.toUpperCase() },
        runGit,
      }),
    ).toBe(SHA);
    expect(runGit).not.toHaveBeenCalled();
  });

  it("refuses to label dirty candidate code with the base commit SHA", () => {
    expect(() =>
      resolveProofRuntimeSha({
        environment: {},
        runGit: (args) =>
          args[0] === "status" ? " M packages/runtime/src/main.ts" : SHA,
      }),
    ).toThrow(/dirty tree/);
  });

  it("uses HEAD only when Git proves the tree is clean", () => {
    expect(
      resolveProofRuntimeSha({
        environment: {},
        runGit: (args) => (args[0] === "status" ? "" : SHA),
      }),
    ).toBe(SHA);
  });
});
