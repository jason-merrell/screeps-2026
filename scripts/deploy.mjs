import { readFile } from "node:fs/promises";

const token = process.env.SCREEPS_TOKEN;
const branch = process.env.SCREEPS_BRANCH || "default";
const host = process.env.SCREEPS_HOST || "https://screeps.com";

if (!token) {
  throw new Error("SCREEPS_TOKEN is required for deployment");
}

const code = await readFile("dist/main.js", "utf8");
const endpoint = new URL("/api/user/code", host);

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

console.log(`Deployed dist/main.js to ${endpoint.host}, Screeps branch '${branch}'.`);
