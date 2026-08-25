import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const branch = process.env.SCREEPS_BRANCH || "default";
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const target = process.env.SCREEPS_TARGET || "world";
const bundlePath = "packages/runtime/dist/main.js";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for deployment verification");
}
if (target !== "world" && target !== "ptr") {
  throw new Error(`SCREEPS_TARGET must be 'world' or 'ptr', received '${target}'`);
}

const expectedCode = await readFile(bundlePath, "utf8");
const apiPrefix = target === "ptr" ? "/ptr" : "";
const endpoint = new URL(`${apiPrefix}/api/user/code`, host);
endpoint.searchParams.set("branch", branch);

const response = await fetch(endpoint, {
  headers: {
    "X-Token": token,
  },
});

const body = await response.text();

if (!response.ok) {
  const scopeHint =
    response.status === 401 || response.status === 403
      ? " Ensure the Screeps auth token allows GET /api/user/code as well as POST /api/user/code."
      : "";
  throw new Error(`Screeps verification request failed (${response.status}).${scopeHint}`);
}

let result;
try {
  result = JSON.parse(body);
} catch {
  throw new Error("Screeps verification returned invalid JSON");
}

if (result.ok !== 1 || !result.modules || typeof result.modules.main !== "string") {
  throw new Error("Screeps verification response did not contain the deployed main module");
}

const deployedCode = result.modules.main;

const fingerprint = (value) =>
  createHash("sha256").update(value, "utf8").digest("hex").slice(0, 12);

if (deployedCode !== expectedCode) {
  throw new Error(
    `Screeps deployment verification failed: local ${fingerprint(expectedCode)} != remote ${fingerprint(deployedCode)}`,
  );
}

console.log(
  `Verified Screeps ${target} branch '${branch}' main module (${fingerprint(deployedCode)}) from ${bundlePath}.`,
);
