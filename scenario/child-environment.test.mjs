import { describe, expect, it } from "vitest";
import { isolatedScenarioEnvironment } from "./child-environment.mjs";

describe("native scenario child environment", () => {
  it("passes only host mechanics and explicit scenario inputs", () => {
    const environment = isolatedScenarioEnvironment(
      { SCENARIO_RESULT_PATH: "/tmp/result.json" },
      {
        PATH: "/usr/bin",
        TMPDIR: "/tmp",
        LANG: "en_US.UTF-8",
        GITHUB_TOKEN: "must-not-cross-boundary",
        NPM_TOKEN: "must-not-cross-boundary",
        SCREEPS_PASSWORD: "must-not-cross-boundary",
        NODE_OPTIONS: "--require=/tmp/inject.cjs",
      },
    );

    expect(environment).toEqual({
      TZ: "UTC",
      PATH: "/usr/bin",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      SCENARIO_RESULT_PATH: "/tmp/result.json",
    });
  });

  it("lets the orchestrator provide a deliberate value for an allowlisted key", () => {
    expect(
      isolatedScenarioEnvironment(
        { PATH: "/controlled/bin" },
        { PATH: "/host/bin" },
      ),
    ).toMatchObject({ PATH: "/controlled/bin", TZ: "UTC" });
  });
});
