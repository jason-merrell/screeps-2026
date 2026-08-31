import { StrategicRoomMap } from "@/components/strategic-room-map";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import type {
  BenchmarkSample,
  ControlPlaneProvenance,
  FspmColonySummary,
  FspmDeliverable,
  FspmEqvmPolicyAuthorization,
  FspmOperationalHealth,
  FspmRequirement,
  FspmTask,
  FspmWeightedEqvmCoverage,
  Snapshot,
} from "@/lib/control-plane";
import { benchmarkPhases, formatEvidenceAge } from "@/lib/data-trust";
import {
  type DevelopmentHealth,
  type DevelopmentStageSummary,
  deriveRoomDevelopment,
  type RoomDevelopmentSummary,
} from "@/lib/room-development";

function metricCard(label: string, value: string | number, detail: string) {
  return (
    <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
      <CardHeader className="pb-3">
        <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em]">
          {label}
        </CardDescription>
        <CardTitle className="lab-stat-value break-words text-2xl tracking-[-0.035em] sm:text-3xl">
          {value}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">
        {detail}
      </CardContent>
    </Card>
  );
}

function CpuBars({ benchmark }: { benchmark: BenchmarkSample }) {
  const entries = benchmarkPhases.flatMap((phase) => {
    const value = benchmark.metrics.phases[phase];
    return value === undefined ? [] : [{ phase, value }];
  });
  if (!entries.length) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm leading-6 text-muted-foreground">
        This benchmark does not persist phase CPU. No baseline values are
        substituted.
      </div>
    );
  }

  const max = Math.max(...entries.map((entry) => entry.value), 1);
  return (
    <div className="grid gap-4">
      {entries.map(({ phase, value }) => (
        <div
          key={phase}
          className="grid grid-cols-[88px_1fr_64px] items-center gap-3 text-sm text-muted-foreground"
        >
          <span className="capitalize">{phase}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${Math.max(2, (value / max) * 100)}%` }}
            />
          </div>
          <span className="text-right font-mono text-xs text-foreground/70">
            {value.toFixed(3)}
          </span>
        </div>
      ))}
      {entries.length < benchmarkPhases.length ? (
        <p className="text-xs leading-5 text-amber-300/85">
          {benchmarkPhases.length - entries.length} phase field
          {benchmarkPhases.length - entries.length === 1 ? " is" : "s are"}{" "}
          absent from this persisted sample.
        </p>
      ) : null}
    </div>
  );
}

const provenanceTextTone = (state: ControlPlaneProvenance["state"]) => {
  if (state === "fresh") return "text-emerald-300";
  if (state === "stale") return "text-amber-300";
  if (state === "partial") return "text-orange-300";
  if (state === "error") return "text-red-300";
  return "text-muted-foreground";
};

const formatFreshnessWindow = (freshForMs: number) => {
  if (freshForMs < 3_600_000) return `${Math.round(freshForMs / 60_000)}m`;
  return `${Math.round(freshForMs / 3_600_000)}h`;
};

function DataProvenance({
  provenance,
}: {
  provenance: ControlPlaneProvenance;
}) {
  const details = [
    ...new Set([
      ...provenance.correlation.issues,
      ...provenance.missingFields.map((field) => `Missing ${field}`),
      ...Object.values(provenance.streams).flatMap((stream) =>
        stream.errorCode
          ? [`${stream.label} query error: ${stream.errorCode}`]
          : [],
      ),
    ]),
  ];

  return (
    <Card className="lab-panel mb-6 rounded-2xl border-white/8 bg-card/65">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">
              Evidence provenance
            </div>
            <div className="mt-1 text-sm leading-6 text-foreground/80">
              {provenance.summary}
            </div>
          </div>
        </div>

        <div className="mt-3 text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground md:hidden">
          Swipe to inspect all evidence streams →
        </div>
        <ul
          aria-label="Evidence streams"
          className="mt-3 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto pb-2 md:mt-4 md:grid md:grid-cols-3 md:overflow-visible md:pb-0"
        >
          {Object.values(provenance.streams).map((stream) => (
            <li
              key={stream.name}
              className="w-[calc(100%-1rem)] min-w-0 shrink-0 snap-start rounded-xl border border-white/8 bg-black/10 p-3 md:w-auto md:shrink"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{stream.label}</span>
                <span
                  className={`text-[0.65rem] font-medium uppercase tracking-[0.12em] ${provenanceTextTone(stream.state)}`}
                >
                  {stream.state}
                </span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatEvidenceAge(stream.ageMs)} · fresh ≤{" "}
                {formatFreshnessWindow(stream.freshForMs)}
              </div>
              <dl className="mt-3 grid gap-1.5 border-t border-white/7 pt-3 text-[0.62rem] leading-4">
                {[
                  [
                    "Source",
                    stream.sourceRef
                      ? `${stream.source ?? "unknown"} · ${stream.sourceRef}`
                      : stream.source,
                  ],
                  [
                    "Scope",
                    [stream.target, stream.shard, stream.room]
                      .map((value) => value ?? "?")
                      .join(" / "),
                  ],
                  ["Captured", stream.observedAt],
                  ["Runtime", stream.runtimeSha],
                  ["Window", stream.sampleWindow],
                  ["Identity", stream.identifier],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="grid min-w-0 grid-cols-[58px_minmax(0,1fr)] gap-2"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-all font-mono text-foreground/65">
                      {value ?? "unavailable"}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <details className="group mt-3 rounded-xl border border-white/7 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer list-none marker:hidden">
            <span className="flex items-center justify-between gap-3">
              <span>
                Correlation & completeness · {provenance.correlation.state}
              </span>
              <span
                className="transition group-open:rotate-45"
                aria-hidden="true"
              >
                +
              </span>
            </span>
          </summary>
          <div className="mt-3 grid gap-3 border-t border-white/7 pt-3">
            <div>
              <div className="font-medium text-foreground/75">Identifiers</div>
              <div className="mt-1 grid gap-1 font-mono text-[0.62rem]">
                {provenance.correlation.identifiers.length ? (
                  provenance.correlation.identifiers.map((identifier) => (
                    <span key={identifier} className="break-all">
                      {identifier}
                    </span>
                  ))
                ) : (
                  <span>No cross-stream identifiers are available.</span>
                )}
              </div>
            </div>
            {details.length ? (
              <div>
                <div className="font-medium text-foreground/75">Gaps</div>
                <ul className="mt-1 grid gap-1">
                  {details.map((detail) => (
                    <li key={detail}>· {detail}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div>No missing fields or correlation conflicts detected.</div>
            )}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}

const formatUtcTimestamp = (value: string | null) => {
  if (!value) return "capture time unavailable";
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "capture time unavailable";
  return timestamp.toISOString();
};

function RuntimeBenchmark({
  benchmark,
}: {
  benchmark: BenchmarkSample | null;
}) {
  if (!benchmark) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm leading-6 text-muted-foreground">
        No timestamped benchmark sample is available. The historical baseline is
        intentionally not shown as current evidence.
      </div>
    );
  }

  if (benchmark.metrics.schema === "headless-comparison") {
    const comparison = benchmark.metrics.comparison;
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Verdict
            </div>
            <div className="mt-1 text-lg font-semibold capitalize">
              {comparison?.verdict ?? "unavailable"}
            </div>
          </div>
          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
              Scenarios
            </div>
            <div className="mt-1 text-lg font-semibold">
              {comparison?.comparisonCount ?? 0}
            </div>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          Controlled headless comparisons do not carry PPAE phase CPU, so no
          phase chart is inferred.
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <CpuBars benchmark={benchmark} />
      <div className="grid grid-cols-3 gap-2 border-t border-white/7 pt-4 text-center">
        <div>
          <div className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
            Avg total
          </div>
          <div className="mt-1 font-mono text-sm">
            {benchmark.metrics.averageTotal?.toFixed(3) ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
            Max total
          </div>
          <div className="mt-1 font-mono text-sm">
            {benchmark.metrics.maxTotal?.toFixed(3) ?? "—"}
          </div>
        </div>
        <div>
          <div className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">
            Samples
          </div>
          <div className="mt-1 font-mono text-sm">
            {benchmark.metrics.sampleCount ?? "—"}
          </div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-muted-foreground">
          {benchmark.metrics.schema}
        </Badge>
        <Badge variant="outline" className="text-muted-foreground">
          {benchmark.metrics.phaseSource ?? "no phase source"}
        </Badge>
        {benchmark.metrics.outcomeStatus ? (
          <Badge variant="outline" className="capitalize text-muted-foreground">
            {benchmark.metrics.outcomeStatus}
          </Badge>
        ) : null}
      </div>
    </div>
  );
}

const developmentHealthTone = (health: DevelopmentHealth) => {
  if (health === "healthy") {
    return "border-emerald-400/25 bg-emerald-400/6 text-emerald-200";
  }
  if (health === "watch") {
    return "border-amber-400/25 bg-amber-400/6 text-amber-200";
  }
  return "border-red-400/30 bg-red-400/7 text-red-200";
};

const stageStatusLabel = (status: DevelopmentStageSummary["status"]) => {
  switch (status) {
    case "realized":
      return "Realized";
    case "in-progress":
      return "In progress";
    case "blocked":
      return "Verified blocker";
    case "not-started":
      return "Not started";
    case "prerequisite-locked":
      return "Prerequisite locked";
    case "future":
      return "Future";
    case "horizon-gap":
      return "Horizon blocked";
    case "invalid-plan":
      return "Evidence invalid";
  }
};

const stageTone = (status: DevelopmentStageSummary["status"]) => {
  if (status === "realized") {
    return {
      border: "border-emerald-400/20 bg-emerald-400/[0.045]",
      label: "text-emerald-300",
      bar: "bg-emerald-400",
    };
  }
  if (status === "in-progress") {
    return {
      border: "border-primary/25 bg-primary/[0.045]",
      label: "text-primary",
      bar: "bg-primary",
    };
  }
  if (status === "not-started") {
    return {
      border: "border-amber-400/20 bg-amber-400/[0.035]",
      label: "text-amber-300",
      bar: "bg-amber-400",
    };
  }
  if (
    status === "horizon-gap" ||
    status === "invalid-plan" ||
    status === "blocked"
  ) {
    return {
      border: "border-red-400/20 bg-red-400/[0.035]",
      label: "text-red-300",
      bar: "bg-red-400",
    };
  }
  return {
    border: "border-white/8 bg-black/10",
    label: "text-muted-foreground",
    bar: "bg-white/20",
  };
};

const structureLabel = (structureType: string) =>
  structureType
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());

function DevelopmentTruthAlert({
  development,
}: {
  development: RoomDevelopmentSummary;
}) {
  if (development.health !== "critical") return null;
  const debt = development.state === "horizon-debt";
  const projectionBlocked =
    (development.projection.fault?.status === "active" &&
      development.projection.faultAlignment === "current") ||
    development.projection.traceAlignment === "mismatch" ||
    development.projection.faultAlignment === "stale";
  const runtimeEvidenceBlocked =
    development.state === "runtime-evidence-unavailable";

  return (
    <section
      aria-label={
        projectionBlocked || runtimeEvidenceBlocked
          ? "Settlement projection evidence blocked"
          : "Footprint evidence blocked"
      }
      className="mb-6 overflow-hidden rounded-2xl border border-red-400/25 bg-red-400/[0.055] shadow-[inset_3px_0_0_rgb(248_113_113/0.7)]"
    >
      <div className="flex flex-col justify-between gap-3 px-4 py-4 sm:flex-row sm:items-center sm:px-5">
        <div>
          <div className="text-[0.65rem] font-medium uppercase tracking-[0.18em] text-red-300">
            {projectionBlocked
              ? "Settlement projection evidence blocked"
              : runtimeEvidenceBlocked
                ? "Runtime development evidence blocked"
                : "Footprint evidence blocked"}
          </div>
          <p className="mt-1 text-sm leading-6 text-foreground/85">
            {debt
              ? `Live controller RCL${development.controllerLevel ?? "?"} exceeds the plan's RCL${development.planHorizonRcl ?? "?"} horizon.`
              : development.nextMilestone.reason}
          </p>
        </div>
        <Badge
          variant="outline"
          className="w-fit shrink-0 border-red-400/30 bg-red-400/10 text-red-200"
        >
          Readiness health overridden
        </Badge>
      </div>
      <div className="border-t border-red-400/15 bg-black/10 px-4 py-2.5 text-xs leading-5 text-red-100/70 sm:px-5">
        Portfolio telemetry remains visible as reported evidence, but the RCL8
        footprint is not evidenced while this implementation debt exists. Lab,
        market, factory, power, nuker, and mature-link actuation are not
        evidenced by this footprint result; their implementation debt remains
        explicit below.
      </div>
    </section>
  );
}

function DevelopmentCommand({
  development,
}: {
  development: RoomDevelopmentSummary;
}) {
  const activeStage = development.stages.find(
    (stage) => stage.id === development.activeStageId,
  );
  const defense = development.defense;
  const projection = development.projection;
  const matureEnergyService = projection.matureEnergyService;
  const currentFault =
    projection.fault?.status === "active" &&
    projection.faultAlignment === "current"
      ? projection.fault
      : null;
  const staleProjectionEvidence =
    projection.traceAlignment === "mismatch" ||
    projection.faultAlignment === "stale";
  const runtimeProjectionBlocked =
    projection.runtimeUsability !== null &&
    (projection.runtimeUsability.usable !== true ||
      projection.runtimeUsability.status !== "current");
  const realization = development.realizationPercentage;
  const missing = development.missingCriticalStructures;
  const headline = currentFault
    ? "Settlement projection replacement fault"
    : runtimeProjectionBlocked
      ? `Operational projection blocked · ${projection.runtimeUsability?.status.replaceAll("_", " ")}`
      : staleProjectionEvidence
        ? "Projection evidence is out of alignment"
        : development.state === "footprint-realized"
          ? "Strategic footprint realized"
          : development.state === "horizon-debt"
            ? "Planning horizon has fallen behind the colony"
            : development.state === "plan-invalid"
              ? "Footprint evidence failed validation"
              : development.state === "runtime-evidence-unavailable"
                ? "Runtime development evidence unavailable"
                : development.state === "plan-missing"
                  ? "Development plan unavailable"
                  : `${activeStage?.title ?? "Development"} is active`;
  const defenseLabel = (() => {
    switch (defense.state) {
      case "ready":
        return "Envelope ready";
      case "strengthening":
        return "Hardening";
      case "condition-unknown":
        return "Strength unknown";
      case "building":
        return "Closing perimeter";
      case "planned":
        return "Ready to build";
      case "missing-plan":
        return "Perimeter missing";
      case "locked":
        return "Unlocks at RCL4";
    }
  })();

  return (
    <Card
      className={`lab-panel overflow-hidden rounded-2xl ${
        development.health === "critical"
          ? "border-red-400/20"
          : development.health === "healthy"
            ? "border-emerald-400/15"
            : "border-primary/15"
      }`}
    >
      <CardHeader className="border-b border-white/8 bg-[linear-gradient(115deg,rgb(235_178_67/0.07),transparent_44%,rgb(47_116_137/0.055))] pb-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <CardDescription className="text-[0.68rem] uppercase tracking-[0.2em] text-primary">
              Development command · runtime projection evidence
            </CardDescription>
            <CardTitle as="h2" className="mt-2 text-2xl tracking-[-0.025em]">
              {headline}
            </CardTitle>
            <CardDescription className="mt-2 max-w-3xl leading-6">
              Exact structure type and room coordinates drive realization. A
              construction site is progress, never a completed outcome.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={developmentHealthTone(development.health)}
            >
              {development.health === "healthy"
                ? "RCL8 footprint realized"
                : development.health === "watch"
                  ? "Footprint evidence partial"
                  : "Footprint evidence blocked"}
            </Badge>
            <Badge variant="outline" className="font-mono text-foreground/70">
              RCL{development.controllerLevel ?? "?"} live · RCL
              {development.planHorizonRcl ?? "?"} plan
            </Badge>
            <Badge
              variant="outline"
              className="font-mono text-foreground/70"
              title={projection.projectionFingerprint ?? undefined}
            >
              planner p{projection.plannerRevision ?? "?"} · projection r
              {projection.projectionRevision ?? "?"} ·{" "}
              {projection.projectionFingerprint?.slice(0, 9) ?? "no identity"}
            </Badge>
            <Badge
              variant="outline"
              className={
                projection.runtimeUsability?.usable === true &&
                projection.runtimeUsability.status === "current"
                  ? "border-emerald-400/25 bg-emerald-400/8 font-mono text-emerald-200"
                  : "border-red-400/25 bg-red-400/8 font-mono text-red-200"
              }
            >
              gate {projection.runtimeUsability?.status ?? "unavailable"}
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="pt-5 sm:pt-6">
        {currentFault ? (
          <section
            aria-label="Current settlement projection fault"
            className="mb-4 rounded-xl border border-red-400/25 bg-red-400/[0.05] p-4 shadow-[inset_3px_0_0_rgb(248_113_113/0.65)]"
          >
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
              <div>
                <div className="text-[0.65rem] uppercase tracking-[0.17em] text-red-300">
                  Projection replacement fault · current retained epoch
                </div>
                <div className="mt-1 text-sm font-medium text-red-100">
                  {currentFault.reason}
                </div>
                <p className="mt-1 text-xs leading-5 text-red-100/70">
                  {currentFault.remediation}
                </p>
              </div>
              <div className="grid shrink-0 grid-cols-2 gap-x-4 gap-y-1 text-xs sm:text-right">
                <span className="text-muted-foreground">Attempts</span>
                <span className="font-mono text-red-100">
                  {currentFault.attemptCount ?? "?"}
                </span>
                <span className="text-muted-foreground">Retry tick</span>
                <span className="font-mono text-red-100">
                  {currentFault.nextRetryTick ?? "manual"}
                </span>
              </div>
            </div>
            <div className="mt-3 border-t border-red-400/15 pt-2 font-mono text-[0.62rem] text-red-100/60">
              retained p{currentFault.retainedPlannerRevision ?? "?"} · r
              {currentFault.retainedProjectionRevision ?? "?"} ·{" "}
              {currentFault.retainedProjectionFingerprint ??
                "identity unavailable"}
            </div>
          </section>
        ) : runtimeProjectionBlocked ? (
          <section
            aria-label="Runtime projection usability failure"
            className="mb-4 rounded-xl border border-red-400/25 bg-red-400/[0.05] px-4 py-3 text-xs leading-5 text-red-100/80"
          >
            <span className="font-mono uppercase tracking-[0.12em] text-red-200">
              {projection.runtimeUsability?.status.replaceAll("_", " ")}
            </span>
            <span className="mt-1 block">
              {projection.runtimeUsability?.reason}
            </span>
          </section>
        ) : staleProjectionEvidence ? (
          <section
            aria-label="Projection evidence mismatch"
            className="mb-4 rounded-xl border border-amber-400/25 bg-amber-400/[0.045] px-4 py-3 text-xs leading-5 text-amber-100/75"
          >
            Runtime settlement evidence does not match this exact planner and
            projection epoch. Refresh the snapshot before acting on fault or
            recovery status.
          </section>
        ) : projection.fault?.status === "superseded" &&
          projection.faultAlignment === "current" ? (
          <section
            aria-label="Settlement projection recovery"
            className="mb-4 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.035] px-4 py-3 text-xs leading-5 text-emerald-100/70"
          >
            {`Settlement generation recovered at tick ${projection.fault.resolvedAtTick ?? "?"}; fault evidence was superseded by projection r${projection.projectionRevision ?? "?"}.`}
          </section>
        ) : null}

        <section
          aria-label="Advanced capability evidence"
          className="mb-4 rounded-xl border border-amber-400/20 bg-amber-400/[0.035] px-4 py-3 text-xs leading-5 text-amber-100/75"
        >
          <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
            <div>
              <div className="font-medium uppercase tracking-[0.14em] text-amber-200">
                Advanced capability actuation · not evidenced
              </div>
              <p className="mt-1">
                Lab, market, factory, power, and nuker services have no runtime
                actuation evaluator in this trace. Footprint completion never
                promotes them to ready.
              </p>
            </div>
            <Badge
              variant="outline"
              className="w-fit shrink-0 border-amber-400/25 bg-amber-400/5 font-mono text-amber-200"
            >
              mature link · {matureEnergyService?.status ?? "unavailable"}
            </Badge>
          </div>
          <p className="mt-2 border-t border-amber-400/15 pt-2">
            {matureEnergyService?.reason ??
              "Mature-link service evidence is unavailable in the current runtime trace; container hauling remains the evidenced fallback."}
          </p>
        </section>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.72fr)_minmax(0,1.35fr)_minmax(270px,0.9fr)]">
          <div className="rounded-xl border border-white/8 bg-black/15 p-4 sm:p-5">
            <div className="text-[0.65rem] uppercase tracking-[0.17em] text-muted-foreground">
              Eligible realization
            </div>
            <div className="mt-3 flex items-end gap-2">
              <span className="font-mono text-4xl font-semibold tracking-[-0.06em] sm:text-5xl">
                {realization === null ? "—" : Math.round(realization)}
              </span>
              <span className="pb-1 text-sm text-muted-foreground">
                {realization === null ? "withheld" : "%"}
              </span>
            </div>
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/7">
              <div
                className={`h-full rounded-full ${
                  development.health === "critical"
                    ? "bg-red-400"
                    : development.health === "healthy"
                      ? "bg-emerald-400"
                      : "bg-primary"
                }`}
                style={{ width: `${realization ?? 0}%` }}
              />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-3 border-t border-white/7 pt-4 text-xs">
              <div>
                <dt className="text-muted-foreground">Missing critical</dt>
                <dd className="mt-1 font-mono text-sm text-foreground">
                  {realization === null
                    ? "withheld"
                    : development.missingStructureCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Blocked</dt>
                <dd className="mt-1 font-mono text-sm text-foreground">
                  {development.blockedStructureCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Active stage</dt>
                <dd className="mt-1 truncate text-sm text-foreground">
                  {activeStage?.title ??
                    (development.state === "footprint-realized"
                      ? "Complete"
                      : "Blocked")}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-xl border border-primary/15 bg-primary/[0.035] p-4 sm:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[0.65rem] uppercase tracking-[0.17em] text-primary">
                Next milestone
              </div>
              <Badge
                variant="outline"
                className="border-primary/20 font-mono text-[0.62rem] text-primary"
              >
                {development.nextMilestone.kind.replaceAll("-", " ")}
              </Badge>
            </div>
            <div className="mt-3 text-lg font-medium tracking-[-0.015em]">
              {development.nextMilestone.title}
            </div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {development.nextMilestone.reason}
            </p>
            {development.firstBlocker ? (
              <div className="mt-4 rounded-lg border border-red-400/20 bg-red-400/[0.04] px-3 py-2.5 text-xs leading-5 text-red-100/75">
                <span className="font-medium text-red-200">
                  First evidenced blocker ·{" "}
                  {development.firstBlocker.occupantType}
                </span>
                <span className="mt-0.5 block">
                  {development.firstBlocker.reason}
                </span>
              </div>
            ) : null}
            {development.validationIssues.length > 1 ? (
              <details className="mt-4 border-t border-white/7 pt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer text-foreground/75">
                  {development.validationIssues.length} validation failures
                </summary>
                <ul className="mt-2 grid gap-1 pl-4">
                  {development.validationIssues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </details>
            ) : null}
          </div>

          <div className="rounded-xl border border-red-400/15 bg-red-400/[0.025] p-4 sm:p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[0.65rem] uppercase tracking-[0.17em] text-red-300/80">
                  Defensive envelope
                </div>
                <div className="mt-2 text-base font-medium">{defenseLabel}</div>
              </div>
              <span
                className={`mt-1 size-2.5 rounded-full ${
                  defense.state === "ready"
                    ? "bg-emerald-400 shadow-[0_0_16px_rgb(52_211_153/0.45)]"
                    : defense.state === "locked"
                      ? "bg-white/20"
                      : "bg-red-400 shadow-[0_0_16px_rgb(248_113_113/0.35)]"
                }`}
                aria-hidden="true"
              />
            </div>
            <dl className="mt-4 grid grid-cols-3 gap-2 border-t border-white/7 pt-4 text-xs">
              <div>
                <dt className="text-muted-foreground">Planned</dt>
                <dd className="mt-1 font-mono text-base text-foreground">
                  {defense.plannedCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Built</dt>
                <dd className="mt-1 font-mono text-base text-foreground">
                  {defense.builtCount}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">At target</dt>
                <dd className="mt-1 font-mono text-base text-foreground">
                  {defense.atTargetCount ?? "—"}
                </dd>
              </div>
            </dl>
            <div className="mt-3 text-xs leading-5 text-muted-foreground">
              {defense.targetHits > 0
                ? `${defense.targetHits.toLocaleString()} hits per rampart${defense.underAttack ? " · doubled threat target" : ""} · ${defense.strategy ?? "strategy unavailable"}`
                : "Rampart hardening target activates at RCL3; envelope evidence is required from RCL4."}
            </div>
          </div>
        </div>

        <div className="mt-4 text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
          Runtime adaptation stages · non-authoritative projection identity ·
          linked deliverable {projection.deliverableId ?? "unavailable"}
        </div>
        <ol
          aria-label="Runtime adaptation stage progression"
          className="mt-2 grid list-none gap-2 md:grid-cols-5"
        >
          {development.stages.map((stage, index) => {
            const tone = stageTone(stage.status);
            return (
              <li
                key={stage.id}
                className={`relative min-w-0 rounded-xl border p-3.5 ${tone.border}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[0.62rem] text-muted-foreground">
                    {String(index + 1).padStart(2, "0")} · RCL{stage.minRcl}
                  </span>
                  <span className={`text-[0.62rem] ${tone.label}`}>
                    {stage.realizationPercentage === null
                      ? "—"
                      : `${Math.round(stage.realizationPercentage)}%`}
                  </span>
                </div>
                <div className="mt-2 truncate text-sm font-medium">
                  {stage.title.replace(" Base", "")}
                </div>
                <div className={`mt-1 text-[0.65rem] ${tone.label}`}>
                  {stageStatusLabel(stage.status)}
                </div>
                <div
                  className="mt-3 h-1 overflow-hidden rounded-full bg-white/7"
                  role="progressbar"
                  aria-label={`${stage.title} realization`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={stage.realizationPercentage ?? undefined}
                  aria-valuetext={
                    stage.realizationPercentage === null
                      ? "Evidence withheld"
                      : `${Math.round(stage.realizationPercentage)} percent`
                  }
                >
                  <div
                    className={`h-full rounded-full ${tone.bar}`}
                    style={{ width: `${stage.realizationPercentage ?? 0}%` }}
                  />
                </div>
              </li>
            );
          })}
        </ol>

        {missing.length > 0 ? (
          <div className="mt-4 border-t border-white/7 pt-4">
            <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
              <div>
                <div className="text-[0.65rem] uppercase tracking-[0.17em] text-muted-foreground">
                  Critical realization queue
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Highest-value missing outcomes, ordered by stage and strategic
                  weight.
                </p>
              </div>
              <span className="font-mono text-xs text-muted-foreground">
                showing {Math.min(missing.length, 4)} of {missing.length}
              </span>
            </div>
            <ul className="mt-3 grid list-none gap-2 lg:grid-cols-4">
              {missing.slice(0, 4).map((requirement) => (
                <li
                  key={requirement.id}
                  className="rounded-lg border border-white/7 bg-black/10 px-3 py-2.5"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate text-sm font-medium">
                      {structureLabel(requirement.structureType)}
                    </span>
                    <span className="shrink-0 font-mono text-[0.62rem] text-primary">
                      w{requirement.strategicWeight}
                    </span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3 text-[0.65rem] text-muted-foreground">
                    <span className="truncate">
                      {requirement.stageId.replaceAll("-", " ")}
                    </span>
                    <span className="shrink-0 font-mono">
                      ({requirement.x},{requirement.y})
                    </span>
                  </div>
                  {requirement.blockers[0] ? (
                    <div className="mt-2 truncate text-[0.62rem] text-red-300">
                      blocked · {requirement.blockers[0].occupantType}
                    </div>
                  ) : requirement.underConstruction ? (
                    <div className="mt-2 text-[0.62rem] text-amber-300">
                      construction in progress
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

const operationalHealthTone = (health?: FspmOperationalHealth) => {
  if (!health) return "border-white/10 text-muted-foreground";
  if (health.state === "healthy")
    return "border-emerald-400/20 bg-emerald-400/5 text-emerald-300";
  if (health.state === "watch")
    return "border-amber-400/20 bg-amber-400/5 text-amber-300";
  return "border-red-400/20 bg-red-400/5 text-red-300";
};

const trendGlyph = (trend?: FspmOperationalHealth["trend"]) => {
  if (trend === "improving") return "↑";
  if (trend === "declining") return "↓";
  if (trend === "stable") return "→";
  return "•";
};

const formatBasisPoints = (value?: number) => {
  if (value === undefined) return "weight unavailable";
  const percent = value / 100;
  return `${Number.isInteger(percent) ? percent.toFixed(0) : percent.toFixed(2)}%`;
};

type AuthorityDisplayState = "eligible" | "blocked" | "legacy";

const requiredGovernanceChecks = [
  "empireRoot",
  "packageProjection",
  "approvalLedger",
  "ancestry",
  "relationships",
  "exactWeights",
  "receiptContracts",
  "acceptancePolicies",
  "receiptLedgers",
] as const;

const compactIdentifier = (value: string, edge = 12) =>
  value.length > edge * 2 + 1
    ? `${value.slice(0, edge)}…${value.slice(-edge)}`
    : value;

function AuthorityIdentifier({
  label,
  value,
}: {
  label: string;
  value?: string | null;
}) {
  if (!value)
    return <span className="text-muted-foreground">Not reported</span>;
  return (
    <details className="group/identifier min-w-0">
      <summary className="cursor-pointer list-none marker:hidden" title={value}>
        <span className="block text-foreground/80">{label}</span>
        <span className="mt-0.5 block truncate font-mono text-[0.68rem] text-muted-foreground">
          {compactIdentifier(value)} <span aria-hidden="true">›</span>
        </span>
      </summary>
      <code className="mt-2 block break-all rounded-lg border border-white/7 bg-black/15 p-2 text-[0.65rem] leading-5 text-foreground/70">
        {value}
      </code>
    </details>
  );
}

const authorityDisplayState = (
  fspm: FspmColonySummary,
): AuthorityDisplayState => {
  const governance = fspm.governance;
  if (!governance) return "legacy";
  const checks = governance.checks;
  return governance.valid &&
    governance.executionEligible === true &&
    checks !== undefined &&
    requiredGovernanceChecks.every((key) => checks[key] === true) &&
    Object.values(checks).every((value) => value === true)
    ? "eligible"
    : "blocked";
};

function RequirementAuthorityBadge({
  requirement,
  authorityState,
}: {
  requirement: FspmRequirement;
  authorityState: AuthorityDisplayState;
}) {
  if (authorityState === "legacy") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/20 bg-amber-400/5 text-amber-300"
      >
        Legacy · cannot authorize
      </Badge>
    );
  }
  if (authorityState === "blocked") {
    if (
      requirement.activationStatus === "missing" ||
      requirement.approval !== true ||
      !requirement.approvalEventId
    ) {
      return (
        <Badge
          variant="outline"
          className="border-red-400/25 bg-red-400/5 text-red-300"
        >
          Activation missing · blocked
        </Badge>
      );
    }
    if (requirement.activationStatus === "invalid") {
      return (
        <Badge
          variant="outline"
          className="border-red-400/25 bg-red-400/5 text-red-300"
        >
          Activation invalid · blocked
        </Badge>
      );
    }
    return (
      <Badge
        variant="outline"
        className="border-amber-400/25 bg-amber-400/5 text-amber-200"
      >
        Activation valid · package blocked
      </Badge>
    );
  }
  if (requirement.approval === true) {
    return (
      <Badge
        variant="outline"
        className="border-cyan-400/20 bg-cyan-400/5 text-cyan-200"
      >
        Activated · Screeps adaptation
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-red-400/25 bg-red-400/5 text-red-300"
    >
      Unapproved · execution blocked
    </Badge>
  );
}

const receiptEvidenceState = (deliverable: FspmDeliverable) =>
  deliverable.receiptEvidenceStatus ?? deliverable.receiptStatus ?? "unknown";

function ReceiptContractBadge({
  deliverable,
}: {
  deliverable: FspmDeliverable;
}) {
  if (deliverable.receiptContractStatus === "valid") {
    return (
      <Badge
        variant="outline"
        className="border-cyan-400/20 bg-cyan-400/5 text-cyan-200"
      >
        Receipt contract · valid
      </Badge>
    );
  }
  if (deliverable.receiptContractStatus === "invalid") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 text-red-300"
      >
        Receipt contract · invalid
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-400/20 bg-amber-400/5 text-amber-300"
    >
      Receipt contract · unknown
    </Badge>
  );
}

function AcceptancePolicyBadge({
  deliverable,
  authorityState,
}: {
  deliverable: FspmDeliverable;
  authorityState: AuthorityDisplayState;
}) {
  if (authorityState === "legacy") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/20 bg-amber-400/5 text-amber-300"
      >
        Acceptance policy · unavailable
      </Badge>
    );
  }
  if (deliverable.servicePrincipalAcceptanceStatus === "valid") {
    return (
      <Badge
        variant="outline"
        className="border-cyan-400/20 bg-cyan-400/5 text-cyan-200"
      >
        Acceptance policy · valid
      </Badge>
    );
  }
  if (deliverable.servicePrincipalAcceptanceStatus === "invalid") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 text-red-300"
      >
        Acceptance policy · invalid
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-400/20 bg-amber-400/5 text-amber-300"
    >
      Acceptance policy · unknown
    </Badge>
  );
}

function ReceiptEvidenceBadge({
  deliverable,
  authorityState,
}: {
  deliverable: FspmDeliverable;
  authorityState: AuthorityDisplayState;
}) {
  if (authorityState === "legacy") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/20 bg-amber-400/5 text-amber-300"
      >
        Receipt evidence · unavailable
      </Badge>
    );
  }
  const state = receiptEvidenceState(deliverable);
  if (state === "validated") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
      >
        Receipt evidence · validated
      </Badge>
    );
  }
  if (state === "invalid") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 text-red-300"
      >
        Receipt evidence · invalid
      </Badge>
    );
  }
  if (state === "missing") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 text-red-300"
      >
        Receipt evidence · required &amp; missing
      </Badge>
    );
  }
  if (state === "pending") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/20 bg-amber-400/5 text-amber-300"
      >
        Receipt evidence · pending
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-400/20 bg-amber-400/5 text-amber-300"
    >
      Receipt evidence · unavailable
    </Badge>
  );
}

function ReceiptAcceptanceBadge({
  deliverable,
  authorityState,
}: {
  deliverable: FspmDeliverable;
  authorityState: AuthorityDisplayState;
}) {
  if (authorityState === "legacy") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/20 bg-amber-400/5 text-amber-300"
      >
        Occurrence acceptance · unavailable
      </Badge>
    );
  }
  const state = deliverable.receiptAcceptanceStatus ?? "unknown";
  if (state === "accepted") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
      >
        Occurrence · accepted (adapted)
      </Badge>
    );
  }
  if (state === "rejected" || state === "invalid" || state === "missing") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 text-red-300"
      >
        Occurrence · {state}
      </Badge>
    );
  }
  if (state === "disputed") {
    return (
      <Badge
        variant="outline"
        className="border-amber-400/25 bg-amber-400/5 text-amber-200"
      >
        Occurrence · disputed
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-400/20 bg-amber-400/5 text-amber-300"
    >
      Occurrence · {state === "pending" ? "pending" : "unavailable"}
    </Badge>
  );
}

function LifecycleBadge({
  status,
  authorityState,
}: {
  status: FspmRequirement["status"];
  authorityState: AuthorityDisplayState;
}) {
  if (authorityState === "legacy") {
    return (
      <Badge
        variant="outline"
        className="border-white/10 text-muted-foreground"
      >
        Definition · historical
      </Badge>
    );
  }
  const blocked = status === "retired" || status === "cancelled";
  return (
    <Badge
      variant="outline"
      className={
        blocked
          ? "border-red-400/25 bg-red-400/5 capitalize text-red-300"
          : "capitalize text-muted-foreground"
      }
    >
      Definition · {status}
    </Badge>
  );
}

function ExecutionBadge({
  authorityState,
}: {
  authorityState: AuthorityDisplayState;
}) {
  if (authorityState === "eligible") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-400/20 bg-emerald-400/5 text-emerald-300"
      >
        Execution · eligible
      </Badge>
    );
  }
  if (authorityState === "blocked") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 text-red-300"
      >
        Execution · blocked
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="border-amber-400/20 bg-amber-400/5 text-amber-300"
    >
      Execution · unavailable
    </Badge>
  );
}

function DeliverableWeightBadge({
  deliverable,
  authorityState,
}: {
  deliverable: FspmDeliverable;
  authorityState: AuthorityDisplayState;
}) {
  if (deliverable.siblingWeightBasisPoints === undefined) return null;
  if (authorityState === "legacy") {
    return (
      <Badge variant="outline" className="font-mono text-muted-foreground">
        Weight · not verified
      </Badge>
    );
  }
  if (deliverable.weightStatus === "invalid") {
    return (
      <Badge
        variant="outline"
        className="border-red-400/25 bg-red-400/5 font-mono text-red-300"
      >
        Weight invalid · {deliverable.siblingWeightBasisPoints.toLocaleString()}{" "}
        / {(deliverable.expectedSiblingWeightBasisPoints ?? 0).toLocaleString()}{" "}
        bp
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className={
        authorityState === "blocked"
          ? "border-amber-400/20 bg-amber-400/5 font-mono text-amber-200"
          : "border-emerald-400/20 bg-emerald-400/5 font-mono text-emerald-300"
      }
    >
      Weight valid · {formatBasisPoints(deliverable.siblingWeightBasisPoints)}
    </Badge>
  );
}

function PortfolioOperationalHealthBadge({
  health,
}: {
  health?: FspmOperationalHealth;
}) {
  return (
    <Badge
      variant="outline"
      className={`gap-1.5 capitalize ${operationalHealthTone(health)}`}
    >
      <span aria-hidden="true">{trendGlyph(health?.trend)}</span>
      <span>Operational health</span>
      <span className="font-mono">
        {health ? `${health.score} · ${health.state}` : "unmeasured"}
      </span>
    </Badge>
  );
}

function OperationalHealthBadge({
  health,
}: {
  health?: FspmOperationalHealth;
}) {
  const tone =
    health?.state === "degraded"
      ? "border-red-400/20 bg-red-400/5 text-red-300"
      : health
        ? "border-sky-400/20 bg-sky-400/5 text-sky-200"
        : "border-white/10 text-muted-foreground";
  return (
    <Badge variant="outline" className={`gap-1.5 ${tone}`}>
      <span>Operational health</span>
      <span className="font-mono">
        {health ? `${health.score} · ${health.state}` : "unmeasured"}
      </span>
    </Badge>
  );
}

function EqvmRollupBadge({
  label,
  score,
  coverage,
  policyAuthorization,
  authorityState,
}: {
  label: "PQI" | "DQI";
  score: number | null | undefined;
  coverage?: FspmWeightedEqvmCoverage;
  policyAuthorization?: FspmEqvmPolicyAuthorization;
  authorityState: AuthorityDisplayState;
}) {
  if (
    authorityState === "eligible" &&
    policyAuthorization?.status === "approved" &&
    typeof score === "number" &&
    coverage?.status === "complete"
  ) {
    return (
      <Badge
        variant="outline"
        className="border-emerald-400/20 font-mono text-emerald-300"
      >
        {label} {score.toFixed(3)} · complete
      </Badge>
    );
  }
  const status = coverage?.status ?? "unavailable";
  const authorizationStatus = policyAuthorization?.status ?? "missing-policy";
  const displayStatus =
    authorityState === "eligible"
      ? authorizationStatus === "approved"
        ? status
        : authorizationStatus
      : `authority-${authorityState}`;
  const tone =
    status === "invalid"
      ? "border-red-400/25 bg-red-400/5 text-red-300"
      : "border-amber-400/20 bg-amber-400/5 text-amber-200";
  return (
    <Badge
      variant="outline"
      className={`font-mono ${tone}`}
      title={
        policyAuthorization?.status === "unapproved"
          ? policyAuthorization.authorizationDebt
          : undefined
      }
    >
      {label} UNAVAILABLE · {displayStatus}
    </Badge>
  );
}

function TaskQi({
  task,
  authorityState,
}: {
  task: FspmTask;
  authorityState: AuthorityDisplayState;
}) {
  const qi = task.qi;
  if (!qi)
    return (
      <Badge variant="outline" className="text-muted-foreground">
        QI UNAVAILABLE · no record
      </Badge>
    );
  if (
    authorityState !== "eligible" ||
    qi.score === null ||
    qi.status !== "complete" ||
    qi.policyAuthorization.status !== "approved"
  )
    return (
      <Badge
        variant="outline"
        className="border-amber-400/20 bg-amber-400/5 font-mono text-amber-200"
        title={
          qi.policyAuthorization.status === "unapproved"
            ? qi.policyAuthorization.authorizationDebt
            : undefined
        }
      >
        QI UNAVAILABLE · policy unapproved
      </Badge>
    );
  const tone =
    qi.score >= 1
      ? "border-emerald-400/20 text-emerald-300"
      : "border-amber-400/20 text-amber-300";
  return (
    <Badge variant="outline" className={`font-mono ${tone}`}>
      QI {qi.score.toFixed(3)} · {qi.ratedActivities}/{qi.totalActivities}
    </Badge>
  );
}

function TaskCard({
  task,
  authorityState,
}: {
  task: FspmTask;
  authorityState: AuthorityDisplayState;
}) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/15 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
            Task
          </div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">
            {task.title ?? task.taskKey ?? task.id}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <LifecycleBadge
            status={task.status}
            authorityState={authorityState}
          />
          <ExecutionBadge authorityState={authorityState} />
          {authorityState === "eligible" &&
          task.taskWeightBasisPoints !== undefined ? (
            <Badge
              variant="outline"
              className="font-mono text-muted-foreground"
            >
              {formatBasisPoints(task.taskWeightBasisPoints)} weight
            </Badge>
          ) : null}
          <TaskQi task={task} authorityState={authorityState} />
        </div>
      </div>

      {task.qi || task.kpiMetric || task.recentActivities?.length ? (
        <details className="group mt-3 rounded-lg border border-white/7 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer list-none font-medium text-foreground/80 marker:hidden">
            <span className="flex items-center justify-between gap-3">
              <span>Measurement detail</span>
              <span
                className="text-muted-foreground transition group-open:rotate-45"
                aria-hidden="true"
              >
                +
              </span>
            </span>
          </summary>
          <div className="mt-3 grid gap-3 border-t border-white/7 pt-3">
            {task.qi ? (
              <div className="rounded-lg border border-amber-400/15 bg-amber-400/[0.025] p-3 leading-5 text-amber-100/75">
                <div className="font-medium text-amber-200">
                  Canonical EQVM ·{" "}
                  {task.qi.score === null ? "unavailable" : task.qi.status}
                </div>
                <div className="mt-1">
                  Coverage {task.qi.status} · {task.qi.freshActivities}/
                  {task.qi.totalActivities} fresh terminal Activities · policy{" "}
                  {task.qi.policyAuthorization.status}
                </div>
                {task.qi.policyAuthorization.status === "unapproved" ? (
                  <div className="mt-1">
                    {task.qi.policyAuthorization.authorizationDebt}
                  </div>
                ) : (
                  <div className="mt-1 font-mono text-[0.62rem] text-amber-100/55">
                    approval {task.qi.policyAuthorization.approvalEventId} ·
                    signer {task.qi.policyAuthorization.signerPrincipalId}
                  </div>
                )}
                <div className="mt-1 font-mono text-[0.62rem] text-amber-100/55">
                  {task.qi.activityWeightPolicyId} · window{" "}
                  {task.qi.evidenceWindowTicks.toLocaleString()} ticks
                </div>
              </div>
            ) : null}
            {task.kpiMetric ? (
              <div className="grid gap-1.5 leading-5">
                <div className="font-medium text-foreground/80">
                  KPI · {task.kpiMetric.metric}
                </div>
                <div>
                  <span className="text-emerald-300">Exceptional 1.5:</span>{" "}
                  {task.kpiMetric.exceptional}
                </div>
                <div>
                  <span className="text-foreground/80">Satisfactory 1.0:</span>{" "}
                  {task.kpiMetric.satisfactory}
                </div>
                <div>
                  <span className="text-amber-300">Unsatisfactory 0.5:</span>{" "}
                  {task.kpiMetric.unsatisfactory}
                </div>
              </div>
            ) : null}
            {task.recentActivities?.length ? (
              <div className="grid gap-1.5 text-[0.68rem]">
                <div className="font-medium text-foreground/80">
                  Recent activity
                </div>
                {task.recentActivities
                  .slice(-4)
                  .reverse()
                  .map((activity) => (
                    <div
                      key={activity.activityId}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span>
                        {activity.activityType} · {activity.actor}
                        {activity.outcome
                          ? ` · ${activity.outcome.actual}/${activity.outcome.target} ${activity.outcome.unit}`
                          : ""}
                      </span>
                      <span className="font-mono capitalize">
                        {activity.rating}
                        {activity.value === null
                          ? ""
                          : ` ${activity.value.toFixed(1)}`}
                        {activity.outcome
                          ? ` · ${Math.round(activity.outcome.utilization * 100)}%`
                          : ""}
                      </span>
                    </div>
                  ))}
              </div>
            ) : null}
          </div>
        </details>
      ) : null}
    </div>
  );
}

function PortfolioTrend({ fspm }: { fspm: FspmColonySummary }) {
  const history = fspm.p3
    ? (fspm.p3OperationalHealthHistory ?? [])
    : (fspm.contractOperationalHealthHistory ?? []);
  const authority = fspm.p3 ? "Portfolio/P3" : "legacy contract";
  if (!history.length)
    return (
      <div className="text-xs text-muted-foreground">
        Trend history has not accumulated yet.
      </div>
    );
  const min = Math.min(...history.map((sample) => sample.score), 0);
  const max = Math.max(...history.map((sample) => sample.score), 100);
  const range = Math.max(1, max - min);

  return (
    <div>
      <div
        className="flex h-16 items-end gap-1"
        role="img"
        aria-label={`${authority} operational health history with ${history.length} samples`}
      >
        {history.map((sample) => (
          <div
            key={sample.tick}
            className="min-w-2 flex-1 rounded-t-sm bg-primary/70"
            style={{
              height: `${Math.max(8, ((sample.score - min) / range) * 100)}%`,
            }}
            title={`tick ${sample.tick}: ${sample.score} ${sample.state}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.62rem] text-muted-foreground">
        <span>
          {history.length} sample{history.length === 1 ? "" : "s"}
        </span>
        <span>latest {history.at(-1)?.score ?? "—"}</span>
      </div>
    </div>
  );
}

function GovernanceAuthority({ fspm }: { fspm: FspmColonySummary }) {
  const governance = fspm.governance;
  if (!governance) {
    return (
      <div
        className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4 text-amber-100 sm:p-5"
        role="status"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-[0.62rem] uppercase tracking-[0.18em] text-amber-300">
              Governance authority unavailable
            </div>
            <div className="mt-1 text-base font-semibold">
              Legacy evidence only
            </div>
          </div>
          <Badge
            variant="outline"
            className="border-amber-400/30 bg-amber-400/5 uppercase tracking-[0.1em] text-amber-300"
          >
            Legacy · read only · cannot authorize execution
          </Badge>
        </div>
        <p className="mt-2 max-w-3xl text-xs leading-5 text-amber-100/65">
          The snapshot predates the governed package projection. Descendant
          records remain inspectable as historical telemetry, but every
          authority and lifecycle state below is inert.
        </p>
      </div>
    );
  }

  const checks = governance.checks;
  const checkEntries = [
    { label: "Empire root authority", value: checks?.empireRoot },
    { label: "Package projection", value: checks?.packageProjection },
    { label: "Adapted activation ledger", value: checks?.approvalLedger },
    { label: "Ancestry", value: checks?.ancestry },
    { label: "Relationships", value: checks?.relationships },
    { label: "Exact weights", value: checks?.exactWeights },
    { label: "Receipt contracts", value: checks?.receiptContracts },
    { label: "Acceptance policies", value: checks?.acceptancePolicies },
    { label: "Receipt ledgers", value: checks?.receiptLedgers },
  ];
  const allChecksValid = checkEntries.every((entry) => entry.value === true);
  const packageValid = governance.valid && allChecksValid;
  const executionEligible =
    packageValid && governance.executionEligible === true;
  const verificationMissing = governance.valid && !checks;
  const tone = executionEligible
    ? "border-emerald-400/20 bg-emerald-400/[0.045]"
    : packageValid
      ? "border-amber-400/25 bg-amber-400/[0.055]"
      : "border-red-400/25 bg-red-400/[0.06]";
  const stateTone = executionEligible
    ? "border-emerald-400/25 bg-emerald-400/5 text-emerald-300"
    : packageValid
      ? "border-amber-400/30 bg-amber-400/5 text-amber-300"
      : "border-red-400/30 bg-red-400/5 text-red-300";
  const verdict = executionEligible
    ? "Valid · execution eligible"
    : packageValid
      ? "Valid · no current execution"
      : verificationMissing
        ? "Unverified · execution blocked"
        : "Invalid · execution blocked";
  const evidencePending = fspm.deliverables.filter((record) => {
    const state = receiptEvidenceState(record);
    return state === "pending" || state === "missing" || state === "unknown";
  }).length;
  const evidenceInvalid = fspm.deliverables.filter(
    (record) => receiptEvidenceState(record) === "invalid",
  ).length;
  const evidenceValidated = fspm.deliverables.filter(
    (record) => receiptEvidenceState(record) === "validated",
  ).length;
  const evidenceTotal = fspm.deliverables.length;
  const acceptanceAccepted = fspm.deliverables.filter(
    (record) => record.receiptAcceptanceStatus === "accepted",
  ).length;
  const acceptanceRejected = fspm.deliverables.filter(
    (record) => record.receiptAcceptanceStatus === "rejected",
  ).length;
  const acceptanceDisputed = fspm.deliverables.filter(
    (record) => record.receiptAcceptanceStatus === "disputed",
  ).length;
  const acceptanceInvalid = fspm.deliverables.filter((record) =>
    ["invalid", "missing"].includes(record.receiptAcceptanceStatus ?? ""),
  ).length;
  const acceptancePending =
    evidenceTotal -
    acceptanceAccepted -
    acceptanceRejected -
    acceptanceDisputed -
    acceptanceInvalid;

  return (
    <div className={`rounded-2xl border p-4 sm:p-5 ${tone}`} role="status">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div
            className={`text-[0.62rem] uppercase tracking-[0.18em] ${executionEligible ? "text-emerald-300" : packageValid ? "text-amber-300" : "text-red-300"}`}
          >
            Governance authority · revision{" "}
            {governance.packageRevision > 0
              ? governance.packageRevision
              : "not reported"}
          </div>
          <div className="mt-1 text-base font-semibold">
            Colony operations authority
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            Effective {governance.effectiveDate} · imported at tick{" "}
            {governance.importedAtTick >= 0
              ? governance.importedAtTick.toLocaleString()
              : "not reported"}
          </div>
        </div>
        <div className="grid max-w-full justify-items-start gap-1.5 sm:justify-items-end sm:text-right">
          <Badge
            variant="outline"
            className={`max-w-full whitespace-normal text-left uppercase tracking-[0.1em] sm:text-right ${stateTone}`}
          >
            {verdict}
          </Badge>
          <span className="max-w-[24rem] text-[0.65rem] leading-4 text-amber-200/80">
            Screeps service-principal adaptation · no canonical human approval
          </span>
        </div>
      </div>

      <div className="mt-4 grid gap-2 rounded-xl border border-white/8 bg-black/10 p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
        <div>
          <span className="font-mono text-foreground">
            {governance.approvalEvents}/{fspm.requirements.length}
          </span>{" "}
          <span className="text-muted-foreground">adapted activations</span>
        </div>
        <div>
          <span className="font-mono text-foreground">
            {fspm.deliverables.length}
          </span>{" "}
          <span className="text-muted-foreground">
            persisted Deliverable definitions
          </span>
        </div>
        <div className="sm:text-right">
          <div className="mb-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
            Receipt evidence
          </div>
          <span className="font-mono text-emerald-300">
            {evidenceValidated} validated
          </span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              evidencePending
                ? "font-mono text-amber-300"
                : "font-mono text-foreground"
            }
          >
            {evidencePending} pending
          </span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              evidenceInvalid
                ? "font-mono text-red-300"
                : "font-mono text-foreground"
            }
          >
            {evidenceInvalid} invalid
          </span>
          <span className="text-muted-foreground"> = </span>
          <span className="font-mono text-foreground">
            {evidenceTotal} Deliverables
          </span>
        </div>
        <div className="sm:text-right">
          <div className="mb-1 text-[0.6rem] uppercase tracking-[0.14em] text-muted-foreground">
            Latest service occurrence
          </div>
          <span className="font-mono text-emerald-300">
            {acceptanceAccepted} accepted
          </span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              acceptancePending
                ? "font-mono text-amber-300"
                : "font-mono text-foreground"
            }
          >
            {acceptancePending} pending
          </span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              acceptanceRejected
                ? "font-mono text-red-300"
                : "font-mono text-foreground"
            }
          >
            {acceptanceRejected} rejected
          </span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              acceptanceDisputed
                ? "font-mono text-amber-200"
                : "font-mono text-foreground"
            }
          >
            {acceptanceDisputed} disputed
          </span>
          <span className="text-muted-foreground"> · </span>
          <span
            className={
              acceptanceInvalid
                ? "font-mono text-red-300"
                : "font-mono text-foreground"
            }
          >
            {acceptanceInvalid} invalid
          </span>
        </div>
      </div>

      <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {checkEntries.map((entry) => (
          <div
            key={entry.label}
            className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-white/8 bg-black/10 p-3"
          >
            <dt className="text-xs text-muted-foreground">{entry.label}</dt>
            <dd
              className={`font-mono text-[0.68rem] font-medium uppercase ${entry.value === true ? "text-emerald-300" : entry.value === false ? "text-red-300" : "text-amber-300"}`}
            >
              {entry.value === true
                ? "Valid"
                : entry.value === false
                  ? "Invalid"
                  : "Not reported"}
            </dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
        <div
          className={`rounded-xl border p-3 ${checks?.exactWeights ? "border-emerald-400/15 bg-emerald-400/[0.03]" : "border-red-400/20 bg-red-400/[0.04]"}`}
        >
          <div className="text-muted-foreground">
            Deliverable weight invariant
          </div>
          <div className="mt-1 font-mono text-foreground">
            {governance.deliverableWeightBasisPoints.toLocaleString()} / 10,000
            bp · {checks?.exactWeights ? "VALID" : "INVALID"}
          </div>
        </div>
        <div className="rounded-xl border border-amber-400/20 bg-amber-400/[0.035] p-3">
          <div className="text-amber-200">Canonical human approval</div>
          <div className="mt-1 font-mono text-amber-300">
            NOT IMPLEMENTED · #164
          </div>
          <div className="mt-1 text-amber-100/60">
            Activated by a source-controlled Screeps service-principal
            adaptation.
          </div>
        </div>
      </div>

      <details className="group mt-3 rounded-xl border border-white/7 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
        <summary className="cursor-pointer list-none marker:hidden">
          <span className="flex items-center justify-between gap-3">
            <span>Attestation evidence</span>
            <span
              className="transition group-open:rotate-90"
              aria-hidden="true"
            >
              ›
            </span>
          </span>
        </summary>
        <dl className="mt-3 grid gap-2 border-t border-white/7 pt-3 sm:grid-cols-[130px_minmax(0,1fr)]">
          <dt>Package</dt>
          <dd className="min-w-0">
            <AuthorityIdentifier
              label="Colony operations package"
              value={governance.packageId}
            />
          </dd>
          <dt>Position</dt>
          <dd className="min-w-0">
            <AuthorityIdentifier
              label="Empire operations accountable position"
              value={governance.accountablePositionId}
            />
          </dd>
          <dt>Signer principal</dt>
          <dd className="min-w-0">
            <AuthorityIdentifier
              label="Repository governance owner"
              value={governance.signerPrincipalId}
            />
          </dd>
          <dt>Package hash</dt>
          <dd className="min-w-0">
            <AuthorityIdentifier
              label="Approved content digest"
              value={governance.packageHash}
            />
          </dd>
          <dt>Governance SHA</dt>
          <dd className="min-w-0">
            <AuthorityIdentifier
              label="Governance documentation revision"
              value={governance.governanceSha}
            />
          </dd>
        </dl>
        <p className="mt-3 border-t border-white/7 pt-3 leading-5">
          Source-control policy attestation is a Screeps adaptation. It is
          intentionally not represented as human approval.
        </p>
      </details>
    </div>
  );
}

function FspmOverview({
  fspm,
  development,
}: {
  fspm: FspmColonySummary | null;
  development: RoomDevelopmentSummary;
}) {
  if (!fspm) {
    return (
      <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
        <CardHeader>
          <CardTitle as="h2" className="text-xl">
            Colony health
          </CardTitle>
          <CardDescription>
            FSPM authority telemetry has not reached the latest sanitized
            snapshot yet.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }
  const authorityState = authorityDisplayState(fspm);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card
        className={`lab-panel min-w-0 rounded-2xl bg-card/65 ${
          development.health === "critical"
            ? "border-red-400/20"
            : "border-white/8"
        }`}
      >
        <CardHeader className="border-b border-white/8 pb-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em] text-primary">
                FSPM operating model
              </CardDescription>
              <CardTitle as="h2" className="mt-2 text-2xl">
                {fspm.p3?.name ??
                  fspm.legacyProgram?.title ??
                  `Room ${fspm.roomName}`}
              </CardTitle>
              <CardDescription className="mt-1">
                Portfolio/P3 → Requirement → Deliverable → Task → measured
                Activity.
              </CardDescription>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <PortfolioOperationalHealthBadge
                health={
                  fspm.p3?.operationalHealth ?? fspm.contract.operationalHealth
                }
              />
              <EqvmRollupBadge
                label="PQI"
                score={fspm.p3?.pqi?.score}
                coverage={fspm.p3?.pqi?.coverage}
                policyAuthorization={fspm.p3?.pqi?.policyAuthorization}
                authorityState={authorityState}
              />
              {development.health === "critical" ? (
                <Badge
                  variant="outline"
                  className="border-red-400/30 bg-red-400/10 text-red-200"
                >
                  RCL8 footprint evidence blocked
                </Badge>
              ) : null}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fspm.requirements.map((requirement) => (
              <div
                key={requirement.id}
                className="rounded-xl border border-white/8 bg-black/10 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                      Requirement
                    </div>
                    <div className="mt-1 truncate text-sm font-medium">
                      {requirement.title ??
                        requirement.domain ??
                        requirement.id}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <RequirementAuthorityBadge
                      requirement={requirement}
                      authorityState={authorityState}
                    />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <span className="capitalize">{requirement.status}</span>
                  {requirement.strategicPriority ? (
                    <span>{requirement.strategicPriority}</span>
                  ) : null}
                  {requirement.revision ? (
                    <span className="font-mono">r{requirement.revision}</span>
                  ) : null}
                </div>
                <div className="mt-3 border-t border-white/7 pt-3">
                  <OperationalHealthBadge
                    health={requirement.operationalHealth}
                  />
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lab-panel min-w-0 rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="pb-3">
          <CardDescription className="text-[0.68rem] uppercase tracking-[0.16em]">
            Portfolio trend
          </CardDescription>
          <CardTitle as="h2" className="text-lg">
            Bounded health window
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PortfolioTrend fspm={fspm} />
          <div className="mt-4 border-t border-white/7 pt-3 text-xs leading-5 text-muted-foreground">
            Canonical EQVM remains unavailable until accountable authority
            approves Activity-weight semantics. Operational health is a separate
            diagnostic channel.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FspmHierarchy({ fspm }: { fspm: FspmColonySummary }) {
  const authorityState = authorityDisplayState(fspm);
  return (
    <div className="grid gap-3">
      {fspm.requirements.map((requirement, requirementIndex) => {
        const deliverables = fspm.deliverables.filter(
          (deliverable) =>
            deliverable.requirementId === requirement.id ||
            (!deliverable.requirementId &&
              deliverable.domain === requirement.domain),
        );
        const primaryDeliverable =
          deliverables.length === 1 ? deliverables[0] : undefined;
        return (
          <details
            key={requirement.id}
            open={requirementIndex === 0}
            className="group rounded-2xl border border-white/8 bg-card/45"
          >
            <summary className="cursor-pointer list-none p-4 marker:hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/8 bg-black/15 text-muted-foreground transition group-open:rotate-90"
                    aria-hidden="true"
                  >
                    ›
                  </span>
                  <div className="min-w-0">
                    <div className="text-[0.62rem] uppercase tracking-[0.18em] text-primary">
                      Requirement
                    </div>
                    <div className="mt-0.5 truncate text-base font-medium">
                      {requirement.title ??
                        requirement.domain ??
                        requirement.id}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <RequirementAuthorityBadge
                    requirement={requirement}
                    authorityState={authorityState}
                  />
                  {requirement.strategicPriority ? (
                    <Badge
                      variant="outline"
                      className="font-mono text-muted-foreground"
                    >
                      {requirement.strategicPriority}
                    </Badge>
                  ) : null}
                  <LifecycleBadge
                    status={requirement.status}
                    authorityState={authorityState}
                  />
                  <ExecutionBadge authorityState={authorityState} />
                  {primaryDeliverable ? (
                    <ReceiptEvidenceBadge
                      deliverable={primaryDeliverable}
                      authorityState={authorityState}
                    />
                  ) : null}
                  {primaryDeliverable ? (
                    <ReceiptAcceptanceBadge
                      deliverable={primaryDeliverable}
                      authorityState={authorityState}
                    />
                  ) : null}
                  <Badge variant="outline" className="text-muted-foreground">
                    {deliverables.length} deliverable
                    {deliverables.length === 1 ? "" : "s"}
                  </Badge>
                </div>
              </div>
            </summary>
            <div className="grid gap-3 border-t border-white/8 p-4 pt-3">
              <dl className="grid gap-x-4 gap-y-2 rounded-xl border border-white/7 bg-black/10 p-3 text-xs sm:grid-cols-[120px_minmax(0,1fr)_120px_minmax(0,1fr)]">
                <dt className="text-muted-foreground">Source</dt>
                <dd className="min-w-0">
                  <AuthorityIdentifier
                    label={
                      requirement.requirementSource
                        ? "Screeps Colony Operations Policy"
                        : "Originating authority"
                    }
                    value={
                      requirement.requirementSource ??
                      requirement.originatingAuthority
                    }
                  />
                </dd>
                <dt className="text-muted-foreground">Applicable OU</dt>
                <dd className="min-w-0">
                  <AuthorityIdentifier
                    label={`${requirement.domain ?? "Colony"} operating unit`}
                    value={requirement.applicableOuId}
                  />
                </dd>
                <dt className="text-muted-foreground">
                  Adapted activation event
                </dt>
                <dd className="min-w-0">
                  {requirement.activationStatus === "missing" ||
                  requirement.activationStatus === "invalid" ? (
                    <div className="rounded-lg border border-red-400/20 bg-red-400/[0.04] p-2 text-red-300">
                      <div className="font-medium">
                        {requirement.activationStatus === "missing"
                          ? "No matching immutable ledger event"
                          : "Ledger event failed authority validation"}
                      </div>
                      <div className="mt-1 text-[0.68rem] text-red-200/65">
                        Projected event ID is suppressed because it cannot
                        authorize execution.
                      </div>
                    </div>
                  ) : (
                    <AuthorityIdentifier
                      label={`${requirement.domain ?? "Requirement"} package activation`}
                      value={requirement.approvalEventId}
                    />
                  )}
                </dd>
                <dt className="text-muted-foreground">Adapted activation</dt>
                <dd className="min-w-0">
                  {requirement.activationStatus === "missing" ||
                  requirement.activationStatus === "invalid" ? (
                    <div className="rounded-lg border border-red-400/20 bg-red-400/[0.04] p-2 text-red-300">
                      <div className="font-medium">
                        Unverified projected activation claim
                      </div>
                      <div className="mt-1 text-[0.68rem] text-red-200/65">
                        Principal and date projections are not authority without
                        the ledger event.
                      </div>
                    </div>
                  ) : (
                    <AuthorityIdentifier
                      label={
                        requirement.dateApproved
                          ? `Repository governance owner · ${requirement.dateApproved}`
                          : "Repository governance owner"
                      }
                      value={requirement.approvedBy}
                    />
                  )}
                </dd>
              </dl>
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-400/10 bg-sky-400/[0.025] p-3 text-xs text-muted-foreground">
                <span>
                  Diagnostic channel · never used as approval or EQVM evidence
                </span>
                <OperationalHealthBadge
                  health={requirement.operationalHealth}
                />
              </div>
              {deliverables.map((deliverable) => {
                const tasks = fspm.tasks.filter(
                  (task) =>
                    task.deliverableId === deliverable.id ||
                    (!task.deliverableId && task.domain === deliverable.domain),
                );
                return (
                  <details
                    key={deliverable.id}
                    className="group/deliverable rounded-xl border border-white/8 bg-black/10"
                  >
                    <summary className="cursor-pointer list-none p-3 marker:hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className="text-muted-foreground transition group-open/deliverable:rotate-90"
                            aria-hidden="true"
                          >
                            ›
                          </span>
                          <div className="min-w-0">
                            <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                              Deliverable
                            </div>
                            <div className="mt-0.5 truncate text-sm font-medium">
                              {deliverable.title ??
                                deliverable.domain ??
                                deliverable.id}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {deliverable.deliverableType ? (
                            <Badge
                              variant="outline"
                              className="capitalize text-muted-foreground"
                            >
                              {deliverable.deliverableType}
                            </Badge>
                          ) : null}
                          <DeliverableWeightBadge
                            deliverable={deliverable}
                            authorityState={authorityState}
                          />
                          <EqvmRollupBadge
                            label="DQI"
                            score={deliverable.dqi?.score}
                            coverage={deliverable.dqi?.coverage}
                            policyAuthorization={
                              deliverable.dqi?.policyAuthorization
                            }
                            authorityState={authorityState}
                          />
                          <ReceiptEvidenceBadge
                            deliverable={deliverable}
                            authorityState={authorityState}
                          />
                          <ReceiptAcceptanceBadge
                            deliverable={deliverable}
                            authorityState={authorityState}
                          />
                          <LifecycleBadge
                            status={deliverable.status}
                            authorityState={authorityState}
                          />
                          <ExecutionBadge authorityState={authorityState} />
                          <Badge
                            variant="outline"
                            className="text-muted-foreground"
                          >
                            {tasks.length} task{tasks.length === 1 ? "" : "s"}
                          </Badge>
                        </div>
                      </div>
                    </summary>
                    <div className="grid gap-2 border-t border-white/7 p-3">
                      <div className="grid gap-2 rounded-xl border border-white/7 bg-black/10 p-3 text-xs sm:grid-cols-2 xl:grid-cols-4">
                        <div>
                          <div className="text-muted-foreground">
                            Task weights
                          </div>
                          {authorityState === "legacy" ? (
                            <div className="mt-1 font-mono text-muted-foreground">
                              NOT REPORTED
                            </div>
                          ) : (
                            <div
                              className={`mt-1 font-mono ${deliverable.taskWeightBasisPoints === 10_000 ? "text-emerald-300" : "text-red-300"}`}
                            >
                              {(
                                deliverable.taskWeightBasisPoints ?? 0
                              ).toLocaleString()}{" "}
                              / 10,000 bp ·{" "}
                              {deliverable.taskWeightBasisPoints === 10_000
                                ? "VALID"
                                : "INVALID"}
                            </div>
                          )}
                        </div>
                        <div>
                          <div className="text-muted-foreground">
                            Task QI coverage
                          </div>
                          <div className="mt-1 font-mono text-foreground/80">
                            {deliverable.dqi
                              ? `${deliverable.dqi.coverage.coveredWeightBasisPoints.toLocaleString()}/${deliverable.dqi.coverage.expectedWeightBasisPoints.toLocaleString()} bp · ${deliverable.dqi.coverage.status}`
                              : "UNAVAILABLE"}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">DQI</div>
                          <div className="mt-1">
                            <EqvmRollupBadge
                              label="DQI"
                              score={deliverable.dqi?.score}
                              coverage={deliverable.dqi?.coverage}
                              policyAuthorization={
                                deliverable.dqi?.policyAuthorization
                              }
                              authorityState={authorityState}
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap content-start gap-1.5">
                          <ReceiptContractBadge deliverable={deliverable} />
                          <AcceptancePolicyBadge
                            deliverable={deliverable}
                            authorityState={authorityState}
                          />
                          <ReceiptEvidenceBadge
                            deliverable={deliverable}
                            authorityState={authorityState}
                          />
                          <ReceiptAcceptanceBadge
                            deliverable={deliverable}
                            authorityState={authorityState}
                          />
                        </div>
                      </div>
                      {deliverable.output ||
                      deliverable.qualityDescription ||
                      deliverable.receiptValidation ? (
                        <div className="grid gap-3 rounded-xl border border-white/7 bg-black/10 p-3 text-xs leading-5 text-muted-foreground lg:grid-cols-3">
                          <div>
                            <div className="font-medium text-foreground/80">
                              Output
                            </div>
                            <div className="mt-1">
                              {deliverable.output ?? "Not reported"}
                            </div>
                          </div>
                          <div>
                            <div className="font-medium text-foreground/80">
                              Quality contract
                            </div>
                            <div className="mt-1">
                              {deliverable.qualityDescription ?? "Not reported"}
                            </div>
                            {deliverable.qualityMetric ? (
                              <div className="mt-1 font-mono text-[0.68rem]">
                                {deliverable.qualityMetric}
                              </div>
                            ) : null}
                          </div>
                          <div>
                            <div className="font-medium text-foreground/80">
                              Receipt contract
                            </div>
                            <div className="mt-1">
                              {deliverable.receiptValidation
                                ? `${deliverable.receiptValidation.evidenceForm} · ${deliverable.receiptValidation.storageLocation}`
                                : "Not reported"}
                            </div>
                            {deliverable.receiptValidation ? (
                              <>
                                <div className="mt-1 font-mono text-[0.68rem]">
                                  captured by{" "}
                                  {
                                    deliverable.receiptValidation
                                      .captureResponsibility
                                  }
                                </div>
                                <div className="mt-1 text-amber-200/70">
                                  {deliverable.servicePrincipalAcceptance
                                    ? `Accepted only for ${deliverable.servicePrincipalAcceptance.acceptedKpiRatings.join(" or ")} terminal Activity KPI evidence. `
                                    : "Acceptance policy not reported. "}
                                  The recurring service definition remains
                                  active; canonical human acceptance remains
                                  #164.
                                </div>
                              </>
                            ) : null}
                          </div>
                        </div>
                      ) : null}
                      {tasks.length ? (
                        tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            authorityState={authorityState}
                          />
                        ))
                      ) : (
                        <div className="rounded-lg border border-dashed border-white/8 p-3 text-xs text-muted-foreground">
                          No approved Tasks in this authority revision.
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

type Experiment = {
  experiment_key: string;
  name: string;
  completed_at: string | null;
  runtime_sha: string | null;
};

type ObservabilityDashboardProps = {
  snapshot: Snapshot | null;
  benchmark: BenchmarkSample | null;
  provenance: ControlPlaneProvenance;
  experiments: Experiment[];
  fspm: FspmColonySummary | null;
  activeView: "overview" | "colony" | "runtime" | "fspm";
};

export function ObservabilityDashboard({
  snapshot,
  benchmark,
  provenance,
  experiments,
  fspm,
  activeView,
}: ObservabilityDashboardProps) {
  const controller = snapshot?.colony?.controller;
  const energy = snapshot?.colony?.energy;
  const development = deriveRoomDevelopment(snapshot);

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      hint: "health & orientation",
      href: "/?view=overview",
      content: <FspmOverview fspm={fspm} development={development} />,
    },
    {
      id: "colony",
      label: "Colony",
      hint: "room & movement",
      href: "/?view=colony",
      content: (
        <div className="grid gap-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.58fr)]">
            <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
              <CardHeader className="border-b border-white/8 pb-5">
                <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-start">
                  <div>
                    <CardTitle as="h2" className="text-xl">
                      Strategic room plan
                    </CardTitle>
                    <CardDescription className="mt-1">
                      Mature geometry, built outcomes, and the defensive cut.
                    </CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className="w-fit font-mono text-muted-foreground"
                  >
                    50 × 50
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="pt-6">
                <StrategicRoomMap
                  snapshot={snapshot}
                  development={development}
                />
              </CardContent>
            </Card>
            <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
              <CardHeader className="border-b border-white/8 pb-5">
                <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em] text-primary">
                  Runtime posture
                </CardDescription>
                <CardTitle as="h2" className="mt-1 text-xl">
                  Construction control
                </CardTitle>
                <CardDescription className="mt-1">
                  What the colony can prove and what remains to execute.
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-5">
                <dl className="grid gap-2 text-sm">
                  {[
                    [
                      "Projection horizon",
                      `v${development.planVersion ?? "?"} · RCL${development.planHorizonRcl ?? "?"}`,
                    ],
                    [
                      "Critical queue",
                      development.realizationPercentage === null
                        ? "withheld"
                        : `${development.missingStructureCount} structures`,
                    ],
                    [
                      "Active sites",
                      `${snapshot?.colony?.constructionSites?.length ?? 0} visible`,
                    ],
                    [
                      "Verified blockers",
                      `${development.blockedStructureCount} evidenced`,
                    ],
                    [
                      "Perimeter",
                      `${development.defense.builtCount}/${development.defense.plannedCount} built`,
                    ],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="flex items-center justify-between gap-4 rounded-lg border border-white/7 bg-black/10 px-3 py-3"
                    >
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd className="font-mono text-xs text-foreground/80">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                {development.firstBlocker ? (
                  <div className="mt-3 rounded-lg border border-red-400/15 bg-red-400/[0.035] px-3 py-2.5 text-xs leading-5 text-red-100/70">
                    <span className="font-medium text-red-200">
                      {development.firstBlocker.occupantType}
                    </span>
                    <span className="mt-0.5 block">
                      {development.firstBlocker.reason}
                    </span>
                  </div>
                ) : null}
                <div className="mt-5 border-t border-white/7 pt-4">
                  <div className="text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground">
                    Movement · supporting system
                  </div>
                  <p className="mt-2 text-xs leading-5 text-muted-foreground">
                    Traffic-aware cached native pathing handles congestion with
                    bounded swap and repath fallbacks. Movement supports the
                    development outcome; it is not the outcome.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
          <DevelopmentCommand development={development} />
        </div>
      ),
    },
    {
      id: "runtime",
      label: "Runtime",
      hint: "CPU & experiments",
      href: "/?view=runtime",
      content: (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5">
              <CardTitle as="h2" className="text-xl">
                PPAE+O runtime profile
              </CardTitle>
              <CardDescription className="mt-1">
                {benchmark
                  ? `${benchmark.benchmarkName} · ${formatUtcTimestamp(benchmark.capturedAt)}`
                  : "Latest timestamped benchmark evidence."}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <RuntimeBenchmark benchmark={benchmark} />
            </CardContent>
          </Card>
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <CardTitle as="h2" className="text-xl">
                    Experiment history
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Completed experiments from the authoritative read model.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="text-muted-foreground">
                  {experiments.length} complete
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid max-h-[420px] gap-2 overflow-auto pr-1">
                {experiments.length ? (
                  experiments.map((experiment) => (
                    <details
                      key={experiment.experiment_key}
                      className="group rounded-xl border border-white/7 bg-black/10 transition open:bg-white/[0.02]"
                    >
                      <summary className="cursor-pointer list-none p-4 marker:hidden">
                        <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                          <div className="min-w-0 truncate">
                            <code className="text-primary">
                              {experiment.experiment_key}
                            </code>{" "}
                            <span className="text-muted-foreground">·</span>{" "}
                            {experiment.name}
                          </div>
                          <span
                            className="text-muted-foreground transition group-open:rotate-45"
                            aria-hidden="true"
                          >
                            +
                          </span>
                        </div>
                      </summary>
                      <div className="border-t border-white/7 px-4 pb-4 pt-3 text-xs text-muted-foreground">
                        {experiment.completed_at ? (
                          <div>Completed {experiment.completed_at}</div>
                        ) : null}
                        {experiment.runtime_sha ? (
                          <div className="mt-1 font-mono">
                            runtime {experiment.runtime_sha}
                          </div>
                        ) : null}
                      </div>
                    </details>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed border-white/8 p-6 text-sm text-muted-foreground">
                    No completed experiment rows yet.
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      ),
    },
    {
      id: "fspm",
      label: "FSPM",
      hint: "Portfolio / P3 drill-down",
      href: "/?view=fspm",
      content: fspm ? (
        <div className="grid gap-4">
          <GovernanceAuthority fspm={fspm} />
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5">
              <CardTitle as="h2" className="text-xl">
                Execution hierarchy
              </CardTitle>
              <CardDescription className="mt-1">
                Authority roots are localized on every row; expand only the
                Requirement, Deliverable, and Task detail you need.
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-5">
              <FspmHierarchy fspm={fspm} />
            </CardContent>
          </Card>
        </div>
      ) : (
        <FspmOverview fspm={null} development={development} />
      ),
    },
  ];

  const genericTelemetry = (
    <>
      <DevelopmentTruthAlert development={development} />
      <DataProvenance provenance={provenance} />
      <section
        aria-label="Colony at a glance"
        className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4"
      >
        {metricCard(
          "Colony",
          snapshot?.room ?? "—",
          `${snapshot?.target ?? "ptr"} / ${snapshot?.shard ?? "shard3"}`,
        )}
        {metricCard(
          "RCL",
          controller?.level ?? "—",
          controller?.progressTotal
            ? `${controller.progress ?? 0} / ${controller.progressTotal}`
            : "controller progress unavailable",
        )}
        {metricCard(
          "Room energy",
          energy ? `${energy.available ?? 0} / ${energy.capacity ?? 0}` : "—",
          "available / capacity",
        )}
        {metricCard(
          "Workforce",
          snapshot?.colony?.creeps ?? "—",
          "visible creeps",
        )}
      </section>
    </>
  );

  return (
    <>
      {activeView === "fspm" ? (
        <>
          <Tabs
            tabs={tabs}
            activeTab={activeView}
            ariaLabel="Observability views"
          />
          <div className="mt-6">{genericTelemetry}</div>
        </>
      ) : (
        <>
          {genericTelemetry}
          <Tabs
            tabs={tabs}
            activeTab={activeView}
            ariaLabel="Observability views"
          />
        </>
      )}
    </>
  );
}
