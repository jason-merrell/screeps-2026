import { readFile } from "node:fs/promises";

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
const experiment = raw?.experiment;
const requestId = String(raw?.request?.id ?? "");
if (!experiment || experiment.name !== "bootstrap-rcl3") {
  console.log("Artifact is not a supported PTR experiment; benchmark persistence is a no-op.");
  process.exit(0);
}
if (!/^\d+$/.test(requestId)) throw new Error(`Invalid experiment request id '${requestId}'`);

const first = Array.isArray(experiment.samples) ? experiment.samples[0] : null;
const final = experiment.final ?? (Array.isArray(experiment.samples) ? experiment.samples.at(-1) : null);
const startedAt = experiment.startedAt ?? first?.collectedAt ?? null;
const completedAt = experiment.completedAt ?? final?.collectedAt ?? null;
const durationMs = startedAt && completedAt
  ? Math.max(0, new Date(completedAt).getTime() - new Date(startedAt).getTime())
  : null;

const transitionSamples = Object.fromEntries(
  Object.entries(experiment.transitions ?? {}).map(([name, transition]) => [name, transition?.sample ?? null]),
);

const metrics = {
  sampleCount: experiment.sampleCount ?? null,
  intervalMs: experiment.intervalMs ?? null,
  durationMs,
  outcomeStatus: experiment.status ?? null,
  startRcl: first?.state?.controller?.level ?? null,
  finalRcl: final?.state?.controller?.level ?? null,
  finalControllerProgress: final?.state?.controller?.progress ?? null,
  finalControllerProgressTotal: final?.state?.controller?.progressTotal ?? null,
  finalWorkforce: final?.state?.workforce?.total ?? null,
  finalSpawnEnergy: final?.state?.energy?.spawnEnergy ?? null,
  finalConstructionSites: final?.state?.constructionSites?.total ?? null,
  controllerProgressDelta: experiment.delta?.controllerProgress ?? null,
  workforceDelta: experiment.delta?.workforce ?? null,
  harvestedDelta: experiment.delta?.harvested ?? null,
  constructionSpendDelta: experiment.delta?.constructionSpend ?? null,
  controllerSpendDelta: experiment.delta?.controllerSpend ?? null,
  cpuAverageTotal: experiment.observability?.cpu?.averageTotal ?? null,
  cpuMaxTotal: experiment.observability?.cpu?.maxTotal ?? null,
  cpuBucketFinal: experiment.observability?.cpu?.bucket ?? null,
  intentsAverageProposed: experiment.observability?.intents?.averageProposed ?? null,
  intentsAverageAccepted: experiment.observability?.intents?.averageAccepted ?? null,
  intentsAverageRejected: experiment.observability?.intents?.averageRejected ?? null,
  milestoneSamples: transitionSamples,
};

const benchmark = {
  schema: "screeps-benchmark-sample/v1",
  schemaVersion: 1,
  sampleKey: `ptr-experiment:${requestId}`,
  benchmarkName: experiment.name,
  runtimeSha,
  capturedAt: completedAt,
  target: "ptr",
  shard: experiment.shard,
  room: experiment.room,
  sourceRef: `github-comment:${requestId}`,
  metrics,
  result: {
    outcomeStatus: experiment.status ?? null,
    sampleCount: experiment.sampleCount ?? null,
    intervalMs: experiment.intervalMs ?? null,
    startedAt,
    completedAt,
    transitions: experiment.transitions ?? {},
    delta: experiment.delta ?? null,
    observability: experiment.observability ?? null,
    final: final
      ? {
          collectedAt: final.collectedAt ?? null,
          state: final.state ?? null,
          evaluation: final.evaluation ?? null,
        }
      : null,
  },
};

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
