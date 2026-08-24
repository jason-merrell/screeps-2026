import { readFile } from "node:fs/promises";
import { evaluateBootstrapState, projectBootstrapState } from "./lib/bootstrap-state.mjs";

const paths = process.argv.slice(2);
if (paths.length === 0) {
  throw new Error("Usage: node scripts/replay-bootstrap.mjs <snapshot.json> [...]");
}

const results = [];
for (const path of paths) {
  const raw = JSON.parse(await readFile(path, "utf8"));
  const state = raw?.schemaVersion ? raw : projectBootstrapState(raw);
  results.push({ path, state, evaluation: evaluateBootstrapState(state) });
}

console.log(JSON.stringify(results, null, 2));
