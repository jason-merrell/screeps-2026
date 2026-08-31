import { mkdir, readFile, writeFile } from "node:fs/promises";

import { restorePtrExecutionCanary } from "./lib/ptr-execution-canary.mjs";

const ARTIFACT_PATH = "artifacts/screeps-insights.json";
const RESTORE_STATE_PATH = "artifacts/ptr-execution-canary-restore.json";

const parsedRequestTimeoutMs = Number(
  process.env.SCREEPS_CANARY_REQUEST_TIMEOUT_MS || "10000",
);
const requestTimeoutMs =
  Number.isInteger(parsedRequestTimeoutMs) &&
  parsedRequestTimeoutMs >= 1_000 &&
  parsedRequestTimeoutMs <= 30_000
    ? parsedRequestTimeoutMs
    : 10_000;

const readJson = async (path) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
};

const writeJson = async (path, value) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

const existingArtifact = (await readJson(ARTIFACT_PATH)) ?? {
  schema: "screeps-ptr-execution-canary/v1",
  status: "failed",
  assurance: "temporary-execution-canary",
  releaseClosure: false,
};

let receipt;
try {
  receipt = await readJson(RESTORE_STATE_PATH);
} catch {
  receipt = { invalid: true };
}

if (!receipt) {
  await writeJson(ARTIFACT_PATH, {
    ...existingArtifact,
    externalRestoration: {
      attempted: false,
      complete: true,
      reason: "restoration-not-armed",
    },
  });
  console.log(
    "PTR canary restoration was not armed; no remote mutation was attempted.",
  );
} else if (
  receipt.invalid === true ||
  receipt.schema !== "screeps-ptr-execution-canary-restore/v1" ||
  receipt.armed !== true ||
  typeof receipt.restoreBranch !== "string" ||
  typeof receipt.canaryBranch !== "string" ||
  typeof receipt.shard !== "string"
) {
  await writeJson(ARTIFACT_PATH, {
    ...existingArtifact,
    externalRestoration: {
      attempted: false,
      complete: false,
      errors: [{ stage: "restore-receipt", code: "invalid-receipt" }],
    },
  });
  console.error(
    "PTR canary restoration receipt is invalid; refusing an unscoped mutation.",
  );
  process.exitCode = 1;
} else {
  let restoration;
  try {
    restoration = await restorePtrExecutionCanary({
      token: process.env.SCREEPS_TOKEN ?? "",
      host: process.env.SCREEPS_HOST || "https://screeps.com",
      restoreBranch: receipt.restoreBranch,
      canaryBranch: receipt.canaryBranch,
      shard: receipt.shard,
      requestTimeoutMs,
    });
  } catch {
    restoration = {
      attempted: true,
      complete: false,
      errors: [{ stage: "external-restoration", code: "restore-start-failed" }],
    };
  }

  await writeJson(ARTIFACT_PATH, {
    ...existingArtifact,
    externalRestoration: restoration,
  });
  if (restoration.complete) {
    await writeJson(RESTORE_STATE_PATH, { ...receipt, armed: false });
    console.log(
      "PTR canary default branch, activation, and temporary-branch cleanup were independently verified.",
    );
  } else {
    console.error("PTR canary external restoration did not verify completely.");
    process.exitCode = 1;
  }
}
