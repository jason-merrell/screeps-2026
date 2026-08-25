import { readFile } from "node:fs/promises";

import { buildExperimentBenchmark } from "./lib/benchmark-sample.mjs";

const artifactPath = process.env.SCREEPS_INSIGHTS_PATH || "artifacts/screeps-insights.json";
const benchmarkUrl = process.env.SUPABASE_BENCHMARK_URL || "";
const runtimeSha = process.env.BENCHMARK_RUNTIME_SHA || process.env.GITHUB_SHA || null;
const oidcRequestUrl = process.env.ACTIONS_ID_TOKEN_REQUEST_URL || "";
const oidcRequestToken = process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN || "";

if (!benchmarkUrl) throw new Error("SUPABASE_BENCHMARK_URL is required");
if (!oidcRequestUrl || !oidcRequestToken) {
  throw new Error("GitHub Actions OIDC environment is required to publish benchmarks");
}

const raw = JSON.parse(await readFile(artifactPath, "utf8"));
const benchmark = buildExperimentBenchmark(raw, { runtimeSha });
if (!benchmark) {
  console.log("Artifact is not a supported PTR experiment; benchmark persistence is a no-op.");
  process.exit(0);
}

const oidcUrl = new URL(oidcRequestUrl);
oidcUrl.searchParams.set("audience", "screeps-supabase-benchmark");
const oidcResponse = await fetch(oidcUrl, {
  headers: { Authorization: `Bearer ${oidcRequestToken}` },
});
if (!oidcResponse.ok) {
  throw new Error(`GitHub OIDC token request failed with HTTP ${oidcResponse.status}`);
}
const oidcBody = await oidcResponse.json();
if (!oidcBody?.value) throw new Error("GitHub OIDC response did not contain a token");

const response = await fetch(benchmarkUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${oidcBody.value}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ benchmark }),
});
const text = await response.text();
let body;
try {
  body = text ? JSON.parse(text) : null;
} catch {
  body = { raw: text };
}
if (!response.ok || body?.ok === false) {
  throw new Error(`Benchmark publish failed with HTTP ${response.status}: ${JSON.stringify(body)}`);
}

console.log(
  `Persisted ${benchmark.benchmarkName} benchmark ${benchmark.sampleKey} for ${benchmark.shard}/${benchmark.room} at ${runtimeSha ?? "unknown-sha"}.`,
);
