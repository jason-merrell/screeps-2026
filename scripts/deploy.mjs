import { readFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const branch = process.env.SCREEPS_BRANCH || "default";
const host = process.env.SCREEPS_HOST || "https://screeps.com";
const target = process.env.SCREEPS_TARGET || "world";
const bundlePath = "packages/runtime/dist/main.js";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for deployment");
}
if (target !== "world" && target !== "ptr") {
  throw new Error(`SCREEPS_TARGET must be 'world' or 'ptr', received '${target}'`);
}

const code = await readFile(bundlePath, "utf8");
const apiPrefix = target === "ptr" ? "/ptr" : "";
const endpoint = new URL(`${apiPrefix}/api/user/code`, host);

const response = await fetch(endpoint, {
  method: "POST",
  headers: {
    "Content-Type": "application/json; charset=utf-8",
    "X-Token": token,
  },
  body: JSON.stringify({
    branch,
    modules: {
      main: code,
    },
  }),
});

const body = await response.text();

if (!response.ok) {
  throw new Error(`Screeps deploy failed (${response.status}): ${body}`);
}

let result;
try {
  result = JSON.parse(body);
} catch {
  throw new Error(`Screeps deploy returned invalid JSON: ${body}`);
}

if (result.ok !== 1) {
  throw new Error(`Screeps deploy was not acknowledged: ${body}`);
}

console.log(
  `Deployed ${bundlePath} to Screeps ${target}, branch '${branch}' (${endpoint.pathname}).`,
);
