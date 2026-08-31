import { mkdir, writeFile } from "node:fs/promises";

import {
  ptrExecutionCanaryBranch,
  runPtrExecutionCanary,
} from "./lib/ptr-execution-canary.mjs";

const ARTIFACT_PATH = "artifacts/screeps-insights.json";
const RESTORE_STATE_PATH = "artifacts/ptr-execution-canary-restore.json";

const token = process.env.SCREEPS_TOKEN ?? "";
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const restoreBranch = process.env.SCREEPS_BRANCH || "default";
const requestId = process.env.SCREEPS_REQUEST_ID || "";
const requestCommand =
  process.env.SCREEPS_COMMAND || "/canary target=ptr room=? shard=?";
const room = (process.env.SCREEPS_ROOM || "").toUpperCase();
const shard = (process.env.SCREEPS_REQUESTED_SHARD || "").toLowerCase();

const boundedInteger = (value, fallback, minimum, maximum) => {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
};

const pollIntervalMs = boundedInteger(
  process.env.SCREEPS_CANARY_POLL_INTERVAL_MS,
  2_000,
  1_000,
  10_000,
);
const timeoutMs = boundedInteger(
  process.env.SCREEPS_CANARY_TIMEOUT_MS,
  180_000,
  30_000,
  600_000,
);
const requestTimeoutMs = boundedInteger(
  process.env.SCREEPS_CANARY_REQUEST_TIMEOUT_MS,
  10_000,
  1_000,
  30_000,
);
const writeJson = async (path, value) => {
  await mkdir("artifacts", { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

let result;
try {
  const canaryBranch = ptrExecutionCanaryBranch(requestId);
  result = await runPtrExecutionCanary({
    token,
    host,
    restoreBranch,
    canaryBranch,
    requestId,
    requestCommand,
    room,
    shard,
    pollIntervalMs,
    timeoutMs,
    requestTimeoutMs,
    onRestoreRequired: (receipt) =>
      writeJson(RESTORE_STATE_PATH, {
        schema: "screeps-ptr-execution-canary-restore/v1",
        armed: true,
        ...receipt,
      }),
  });
} catch {
  result = {
    schema: "screeps-ptr-execution-canary/v1",
    request: {
      id: String(requestId),
      mode: "canary",
      command: requestCommand,
      target: "ptr",
      room: room || null,
      shard: shard || null,
    },
    collectedAt: new Date().toISOString(),
    status: "failed",
    assurance: "temporary-execution-canary",
    releaseClosure: false,
    failure: { stage: "configuration", code: "canary-start-failed" },
  };
}

await writeJson(ARTIFACT_PATH, result);

const sampleCount = result.canary?.samples?.length ?? 0;
const restoration =
  result.restoration?.complete === true ? "complete" : "pending";
console.log(
  `PTR execution canary ${result.status}; accepted ${sampleCount} bounded samples; restoration=${restoration}.`,
);
