import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const parserPath = path.join(
  repositoryRoot,
  "scripts/parse-insights-request.mjs",
);

async function parseRequest(request) {
  const directory = await mkdtemp(path.join(tmpdir(), "screeps-request-"));
  const outputPath = path.join(directory, "github-output.txt");
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [parserPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: "issue_comment",
      SCREEPS_REQUEST: request,
      SCREEPS_COMMENT_ID: "123456789",
      GITHUB_OUTPUT: outputPath,
    },
  });
  const output = result.status === 0 ? await readFile(outputPath, "utf8") : "";
  return { result, output };
}

describe("insights benchmark request", () => {
  it("defaults controlled comparisons to three repetitions", async () => {
    const { result, output } = await parseRequest(
      "/benchmark name=traffic-suite",
    );

    expect(result.status, result.stderr).toBe(0);
    expect(output).toContain("benchmark_runs=3\n");
    expect(output).toContain("command=/benchmark name=traffic-suite runs=3\n");
  });

  it("rejects a two-run comparison as insufficient evidence", async () => {
    const { result } = await parseRequest(
      "/benchmark name=bootstrap-suite runs=2",
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "/benchmark runs must be an integer from 3 through 5",
    );
  });

  it("accepts an explicitly stronger five-run comparison", async () => {
    const { result, output } = await parseRequest(
      "/benchmark name=bootstrap-suite runs=5",
    );

    expect(result.status, result.stderr).toBe(0);
    expect(output).toContain("benchmark_runs=5\n");
  });
});
