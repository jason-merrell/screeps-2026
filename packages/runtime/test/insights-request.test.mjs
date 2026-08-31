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

async function parseDispatch({ room = "", shard = "", target = "world" }) {
  const directory = await mkdtemp(path.join(tmpdir(), "screeps-dispatch-"));
  const outputPath = path.join(directory, "github-output.txt");
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(process.execPath, [parserPath], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {
      ...process.env,
      GITHUB_EVENT_NAME: "workflow_dispatch",
      GITHUB_RUN_ID: "987654321",
      SCREEPS_INPUT_ROOM: room,
      SCREEPS_INPUT_SHARD: shard,
      SCREEPS_INPUT_TARGET: target,
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

describe("PTR insights request", () => {
  it("accepts only an explicit room-bound PTR execution canary", async () => {
    const { result, output } = await parseRequest(
      "/canary target=PTR room=e52n38 shard=SHARD3",
    );

    expect(result.status, result.stderr).toBe(0);
    expect(output).toContain("mode=canary\n");
    expect(output).toContain("target=ptr\n");
    expect(output).toContain("room=E52N38\n");
    expect(output).toContain("shard=shard3\n");
    expect(output).toContain(
      "command=/canary target=ptr room=E52N38 shard=shard3\n",
    );
  });

  it.each([
    "/canary target=ptr room=E52N38",
    "/canary target=ptr shard=shard3",
    "/canary target=world room=E52N38 shard=shard3",
  ])("rejects unsafe canary request %s", async (request) => {
    const { result } = await parseRequest(request);
    expect(result.status).toBe(1);
  });

  it("requires an explicit atomic room and shard for PTR collection", async () => {
    for (const request of [
      "/collect target=ptr",
      "/collect target=ptr room=E52N38",
      "/collect target=ptr shard=shard3",
    ]) {
      const { result } = await parseRequest(request);
      expect(result.status, request).toBe(1);
      expect(result.stderr).toContain("target=ptr requires room=<ROOM>");
    }
  });

  it("normalizes the complete PTR request", async () => {
    const { result, output } = await parseRequest(
      "/collect target=PTR room=e52n38 shard=SHARD3",
    );

    expect(result.status, result.stderr).toBe(0);
    expect(output).toContain("target=ptr\n");
    expect(output).toContain("room=E52N38\n");
    expect(output).toContain("shard=shard3\n");
    expect(output).toContain(
      "command=/collect target=ptr room=E52N38 shard=shard3\n",
    );
  });

  it("propagates a complete workflow-dispatch PTR target", async () => {
    const { result, output } = await parseDispatch({
      room: "e52n38",
      shard: "SHARD3",
      target: "PTR",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(output).toContain("target=ptr\n");
    expect(output).toContain(
      "command=/collect target=ptr room=E52N38 shard=shard3\n",
    );
  });

  it("rejects an incomplete workflow-dispatch PTR target", async () => {
    const { result } = await parseDispatch({ target: "ptr" });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      "PTR workflow dispatch requires room and shard",
    );
  });
});
