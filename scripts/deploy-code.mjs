import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const branch = process.env.SCREEPS_BRANCH || "default";
const target = (process.env.SCREEPS_TARGET || "ptr").toLowerCase();
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand =
  process.env.SCREEPS_COMMAND || `/deploy-code target=${target}`;
const allowWorldDeployment = process.env.SCREEPS_ALLOW_WORLD_DEPLOYMENT === "true";
const bundlePath = "packages/runtime/dist/main.js";
const apiPrefix = target === "ptr" ? "/ptr" : "";
const targetLabel = target === "ptr" ? "PTR" : "World";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for code deployment");
}
if (target !== "ptr" && target !== "world") {
  throw new Error(`Unsupported deployment target '${target}'`);
}
if (target === "world" && !allowWorldDeployment) {
  throw new Error(
    "World deployment requires SCREEPS_ALLOW_WORLD_DEPLOYMENT=true; refusing live mutation",
  );
}

const code = await readFile(bundlePath, "utf8");
const endpoint = new URL(`${apiPrefix}/api/user/code`, host);

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "X-Token": token,
  },
  body: JSON.stringify({
    branch,
    modules: { main: code },
  }),
});

const responseText = await response.text();
let deployment;
try {
  deployment = JSON.parse(responseText);
} catch {
  deployment = responseText;
}

if (!response.ok || deployment?.ok !== 1) {
  throw new Error(
    `${targetLabel} code deploy failed (${response.status}): ${responseText}`,
  );
}

const verifyEndpoint = new URL(`${apiPrefix}/api/user/code`, host);
verifyEndpoint.searchParams.set("branch", branch);
const verifyResponse = await fetch(verifyEndpoint, {
  headers: { "X-Token": token },
});
const verifyText = await verifyResponse.text();
let verified;
try {
  verified = JSON.parse(verifyText);
} catch {
  throw new Error(`${targetLabel} code verification returned invalid JSON`);
}

if (
  !verifyResponse.ok ||
  verified?.ok !== 1 ||
  typeof verified?.modules?.main !== "string"
) {
  throw new Error(`${targetLabel} code verification failed (${verifyResponse.status})`);
}

const fingerprint = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);

if (verified.modules.main !== code) {
  throw new Error(
    `${targetLabel} code mismatch: local ${fingerprint(code)} != remote ${fingerprint(verified.modules.main)}`,
  );
}

const snapshot = {
  request: {
    id: requestId,
    mode: "deploy-code",
    command: requestCommand,
    target,
  },
  collectedAt: new Date().toISOString(),
  host,
  target,
  branch,
  result: "deployed-and-verified",
  fingerprint: fingerprint(code),
  bytes: Buffer.byteLength(code, "utf8"),
};

await mkdir("artifacts", { recursive: true });
await writeFile(
  "artifacts/screeps-insights.json",
  `${JSON.stringify(snapshot, null, 2)}\n`,
  "utf8",
);

console.log(
  `Deployed and verified ${targetLabel} branch '${branch}' from ${bundlePath} (${snapshot.fingerprint}, ${snapshot.bytes} bytes).`,
);
