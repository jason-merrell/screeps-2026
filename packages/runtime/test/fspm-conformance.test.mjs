import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const manifestPath = path.join(repositoryRoot, "docs/fspm-conformance.json");
const validatorPath = path.join(
  repositoryRoot,
  "scripts/validate-fspm-conformance.mjs",
);

const runValidator = async (profile) => {
  const directory = await mkdtemp(
    path.join(tmpdir(), "screeps-fspm-conformance-"),
  );
  const candidatePath = path.join(directory, "profile.json");
  await writeFile(
    candidatePath,
    `${JSON.stringify(profile, null, 2)}\n`,
    "utf8",
  );
  const { spawnSync } = await import("node:child_process");
  return spawnSync(
    process.execPath,
    [validatorPath, "--manifest", candidatePath, "--json"],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );
};

const loadProfile = async () =>
  JSON.parse(await readFile(manifestPath, "utf8"));

describe("FSPM conformance profile", () => {
  it("validates the checked-in profile against the runtime governance pin", async () => {
    const result = await runValidator(await loadProfile());

    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      profileStatus: "partial",
      governanceCommit: "02d581886a759d19044ff91a80d743fa042f23f7",
      components: 10,
      valid: true,
    });
  });

  it("rejects a full-parity claim while required canonical items are missing", async () => {
    const profile = await loadProfile();
    profile.profileStatus = "full";

    const result = await runValidator(profile);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      "profileStatus: full parity is forbidden while any required item is not implemented",
    );
  });

  it("rejects governance drift from the runtime catalog pin", async () => {
    const profile = await loadProfile();
    profile.governance.commit = "1111111111111111111111111111111111111111";

    const result = await runValidator(profile);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      "governance.commit: manifest SHA differs from runtime catalog SHA 02d581886a759d19044ff91a80d743fa042f23f7",
    );
  });

  it("rejects evidence paths that do not exist", async () => {
    const profile = await loadProfile();
    profile.components[0].fields[0].evidence = [
      "packages/runtime/src/does-not-exist.ts",
    ];

    const result = await runValidator(profile);

    expect(result.status).toBe(1);
    expect(JSON.parse(result.stdout).failures).toContain(
      "components[0].fields[0].evidence[0]: evidence path does not exist: packages/runtime/src/does-not-exist.ts",
    );
  });

  it("generates a human-readable release report from the same profile", async () => {
    const { spawnSync } = await import("node:child_process");
    const result = spawnSync(process.execPath, [validatorPath, "--markdown"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("# NTI FSPM conformance report");
    expect(result.stdout).toContain("| P3 authority record |");
    expect(result.stdout).toContain("## Open conformance gaps");
    expect(result.stdout).toContain("`child_deliverables`");
    expect(result.stdout).toContain("`project_activation_and_persistence`");
    expect(result.stdout).toContain(
      "Namauu/governance-docs@02d581886a759d19044ff91a80d743fa042f23f7",
    );
  });
});
