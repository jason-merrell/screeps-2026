import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const branch = process.env.SCREEPS_BRANCH || "default";
const requestId = process.env.SCREEPS_REQUEST_ID || "unknown";
const requestCommand = process.env.SCREEPS_COMMAND || "/deploy-code target=ptr";
const bundlePath = "packages/runtime/dist/main.js";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for PTR code deployment");
}

const code = await readFile(bundlePath, "utf8");
const endpoint = new URL("/ptr/api/user/code", host);

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
let placement;
try {
  placement = JSON.parse(responseText);
} catch {
  placement = responseText;
}

if (!response.ok || placement?.ok !== 1) {
  throw new Error(`PTR code deploy failed (${response.status}): ${responseText}`);
}

const verifyEndpoint = new URL("/ptr/api/user/code", host);
verifyEndpoint.searchParams.set("branch", branch);
const verifyResponse = await fetch(verifyEndpoint, {
  headers: { "X-Token": token },
});
const verifyText = await verifyResponse.text();
let verified;
try {
  verified = JSON.parse(verifyText);
} catch {
  throw new Error("PTR code verification returned invalid JSON");
}

if (
  !verifyResponse.ok ||
  verified?.ok !== 1 ||
  typeof verified?.modules?.main !== "string"
) {
  throw new Error(`PTR code verification failed (${verifyResponse.status})`);
}

const fingerprint = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);

if (verified.modules.main !== code) {
  throw new Error(
    `PTR code mismatch: local ${fingerprint(code)} != remote ${fingerprint(verified.modules.main)}`,
  );
}

const snapshot = {
  request: {
    id: requestId,
    mode: "deploy-code",
    command: requestCommand,
    target: "ptr",
  },
  collectedAt: new Date().toISOString(),
  host,
  target: "ptr",
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
  `Deployed and verified PTR branch '${branch}' from ${bundlePath} (${snapshot.fingerprint}, ${snapshot.bytes} bytes).`,
);
