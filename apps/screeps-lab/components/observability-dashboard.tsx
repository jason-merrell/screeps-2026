import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import type {
  BenchmarkSample,
  ControlPlaneProvenance,
  FspmColonySummary,
  FspmQuality,
  FspmTask,
  Point,
  Snapshot,
} from "@/lib/control-plane";
import { benchmarkPhases, formatEvidenceAge } from "@/lib/data-trust";

function metricCard(label: string, value: string | number, detail: string) {
  return (
    <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
      <CardHeader className="pb-3">
        <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em]">{label}</CardDescription>
        <CardTitle className="lab-stat-value break-words text-2xl tracking-[-0.035em] sm:text-3xl">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">{detail}</CardContent>
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
        This benchmark does not persist phase CPU. No baseline values are substituted.
      </div>
    );
  }

  const max = Math.max(...entries.map((entry) => entry.value), 1);
  return (
    <div className="grid gap-4">
      {entries.map(({ phase, value }) => (
        <div key={phase} className="grid grid-cols-[88px_1fr_64px] items-center gap-3 text-sm text-muted-foreground">
          <span className="capitalize">{phase}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.max(2, (value / max) * 100)}%` }} />
          </div>
          <span className="text-right font-mono text-xs text-foreground/70">{value.toFixed(3)}</span>
        </div>
      ))}
      {entries.length < benchmarkPhases.length ? (
        <p className="text-xs leading-5 text-amber-300/85">
          {benchmarkPhases.length - entries.length} phase field{benchmarkPhases.length - entries.length === 1 ? " is" : "s are"} absent from this persisted sample.
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

function DataProvenance({ provenance }: { provenance: ControlPlaneProvenance }) {
  const details = [...new Set([
    ...provenance.correlation.issues,
    ...provenance.missingFields.map((field) => `Missing ${field}`),
    ...Object.values(provenance.streams).flatMap((stream) =>
      stream.errorCode ? [`${stream.label} query error: ${stream.errorCode}`] : []
    ),
  ])];

  return (
    <Card className="lab-panel mb-6 rounded-2xl border-white/8 bg-card/65">
      <CardContent className="p-4 sm:p-5">
        <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Evidence provenance</div>
            <div className="mt-1 text-sm leading-6 text-foreground/80">{provenance.summary}</div>
          </div>
        </div>

        <div className="mt-3 text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground md:hidden">Swipe to inspect all evidence streams →</div>
        <ul aria-label="Evidence streams" className="mt-3 flex list-none snap-x snap-mandatory gap-2 overflow-x-auto pb-2 md:mt-4 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
          {Object.values(provenance.streams).map((stream) => (
            <li key={stream.name} className="w-[calc(100%-1rem)] min-w-0 shrink-0 snap-start rounded-xl border border-white/8 bg-black/10 p-3 md:w-auto md:shrink">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{stream.label}</span>
                <span className={`text-[0.65rem] font-medium uppercase tracking-[0.12em] ${provenanceTextTone(stream.state)}`}>{stream.state}</span>
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatEvidenceAge(stream.ageMs)} · fresh ≤ {formatFreshnessWindow(stream.freshForMs)}
              </div>
              <dl className="mt-3 grid gap-1.5 border-t border-white/7 pt-3 text-[0.62rem] leading-4">
                {[
                  ["Source", stream.sourceRef ? `${stream.source ?? "unknown"} · ${stream.sourceRef}` : stream.source],
                  ["Scope", [stream.target, stream.shard, stream.room].map((value) => value ?? "?").join(" / ")],
                  ["Captured", stream.observedAt],
                  ["Runtime", stream.runtimeSha],
                  ["Window", stream.sampleWindow],
                  ["Identity", stream.identifier],
                ].map(([label, value]) => (
                  <div key={label} className="grid min-w-0 grid-cols-[58px_minmax(0,1fr)] gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="break-all font-mono text-foreground/65">{value ?? "unavailable"}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>

        <details className="group mt-3 rounded-xl border border-white/7 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer list-none marker:hidden">
            <span className="flex items-center justify-between gap-3">
              <span>Correlation & completeness · {provenance.correlation.state}</span>
              <span className="transition group-open:rotate-45" aria-hidden="true">+</span>
            </span>
          </summary>
          <div className="mt-3 grid gap-3 border-t border-white/7 pt-3">
            <div>
              <div className="font-medium text-foreground/75">Identifiers</div>
              <div className="mt-1 grid gap-1 font-mono text-[0.62rem]">
                {provenance.correlation.identifiers.length
                  ? provenance.correlation.identifiers.map((identifier) => <span key={identifier} className="break-all">{identifier}</span>)
                  : <span>No cross-stream identifiers are available.</span>}
              </div>
            </div>
            {details.length ? (
              <div>
                <div className="font-medium text-foreground/75">Gaps</div>
                <ul className="mt-1 grid gap-1">
                  {details.map((detail) => <li key={detail}>· {detail}</li>)}
                </ul>
              </div>
            ) : <div>No missing fields or correlation conflicts detected.</div>}
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

function RuntimeBenchmark({ benchmark }: { benchmark: BenchmarkSample | null }) {
  if (!benchmark) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm leading-6 text-muted-foreground">
        No timestamped benchmark sample is available. The historical baseline is intentionally not shown as current evidence.
      </div>
    );
  }

  if (benchmark.metrics.schema === "headless-comparison") {
    const comparison = benchmark.metrics.comparison;
    return (
      <div className="grid gap-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Verdict</div>
            <div className="mt-1 text-lg font-semibold capitalize">{comparison?.verdict ?? "unavailable"}</div>
          </div>
          <div className="rounded-xl border border-white/8 bg-black/10 p-4">
            <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Scenarios</div>
            <div className="mt-1 text-lg font-semibold">{comparison?.comparisonCount ?? 0}</div>
          </div>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">Controlled headless comparisons do not carry PPAE phase CPU, so no phase chart is inferred.</p>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <CpuBars benchmark={benchmark} />
      <div className="grid grid-cols-3 gap-2 border-t border-white/7 pt-4 text-center">
        <div><div className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">Avg total</div><div className="mt-1 font-mono text-sm">{benchmark.metrics.averageTotal?.toFixed(3) ?? "—"}</div></div>
        <div><div className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">Max total</div><div className="mt-1 font-mono text-sm">{benchmark.metrics.maxTotal?.toFixed(3) ?? "—"}</div></div>
        <div><div className="text-[0.62rem] uppercase tracking-[0.14em] text-muted-foreground">Samples</div><div className="mt-1 font-mono text-sm">{benchmark.metrics.sampleCount ?? "—"}</div></div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Badge variant="outline" className="text-muted-foreground">{benchmark.metrics.schema}</Badge>
        <Badge variant="outline" className="text-muted-foreground">{benchmark.metrics.phaseSource ?? "no phase source"}</Badge>
        {benchmark.metrics.outcomeStatus ? <Badge variant="outline" className="capitalize text-muted-foreground">{benchmark.metrics.outcomeStatus}</Badge> : null}
      </div>
    </div>
  );
}

function RoomGrid({ snapshot }: { snapshot: Snapshot | null }) {
  type Layer = "roads" | "extensions" | "towers" | "containers" | "spawn" | "hub" | "sources" | "controller" | "built" | "construction";
  const layers: Record<Layer, Map<string, Point>> = {
    roads: new Map(),
    extensions: new Map(),
    towers: new Map(),
    containers: new Map(),
    spawn: new Map(),
    hub: new Map(),
    sources: new Map(),
    controller: new Map(),
    built: new Map(),
    construction: new Map(),
  };
  const mark = (point: Point | null | undefined, layer: Layer) => {
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) return;
    if (point.x < 0 || point.x > 49 || point.y < 0 || point.y > 49) return;
    layers[layer].set(`${point.x}:${point.y}`, point);
  };
  const squarePath = (points: Iterable<Point>, inset = 0, size = 1) =>
    [...points].map((point) => `M${point.x + inset} ${point.y + inset}h${size}v${size}h-${size}z`).join("");

  const plan = snapshot?.roomPlan;
  for (const road of plan?.roads ?? []) mark(road, "roads");
  for (const structure of plan?.structures ?? []) {
    const layer =
      structure.structureType === "tower"
        ? "towers"
        : structure.structureType === "container"
          ? "containers"
          : "extensions";
    mark(structure, layer);
  }
  mark(plan?.anchors?.spawn, "spawn");
  mark(plan?.anchors?.hub, "hub");
  mark(plan?.anchors?.controller, "controller");
  for (const source of plan?.anchors?.sources ?? []) {
    mark(source, "sources");
    mark(source.container, "containers");
  }
  for (const structure of snapshot?.colony?.structures ?? []) mark(structure, "built");
  for (const site of snapshot?.colony?.constructionSites ?? []) mark(site, "construction");

  const layerCounts = [
    `${layers.roads.size} planned roads`,
    `${layers.extensions.size + layers.towers.size + layers.containers.size} planned structures`,
    `${layers.built.size} built structures`,
    `${layers.construction.size} construction sites`,
  ].join(", ");

  return (
    <>
      <svg className="room-grid" viewBox="0 0 50 50" role="img" aria-labelledby="room-grid-title room-grid-description">
        <title id="room-grid-title">50 by 50 Screeps room plan</title>
        <desc id="room-grid-description">{`Planned geometry overlaid with live built state: ${layerCounts}.`}</desc>
        <defs>
          <pattern id="room-grid-lines" width="1" height="1" patternUnits="userSpaceOnUse">
            <path d="M1 0H0V1" fill="none" stroke="rgb(255 255 255 / 5%)" strokeWidth="0.05" />
          </pattern>
        </defs>
        <rect width="50" height="50" fill="#081016" />
        <g className="room-plan-layer">
          <path d={squarePath(layers.roads.values())} fill="#314858" />
          <path d={squarePath(layers.extensions.values(), 0.08, 0.84)} fill="#28735d" />
          <path d={squarePath(layers.towers.values(), 0.06, 0.88)} fill="#b9823f" />
          <path d={squarePath(layers.containers.values(), 0.08, 0.84)} fill="#755f42" />
          <path d={squarePath(layers.hub.values(), 0.05, 0.9)} fill="#4c89b5" />
          <path d={squarePath(layers.spawn.values(), 0.04, 0.92)} fill="#e7bd55" stroke="#fff0b5" strokeWidth="0.7" vectorEffect="non-scaling-stroke" />
          {[...layers.sources.values()].map((point) => <circle key={`${point.x}:${point.y}`} cx={point.x + 0.5} cy={point.y + 0.5} r="0.42" fill="#dbb64f" />)}
          {[...layers.controller.values()].map((point) => <circle key={`${point.x}:${point.y}`} cx={point.x + 0.5} cy={point.y + 0.5} r="0.42" fill="#8d72bc" />)}
          <path d={squarePath(layers.built.values(), 0.18, 0.64)} fill="none" stroke="rgb(255 255 255 / 88%)" strokeWidth="0.75" vectorEffect="non-scaling-stroke" />
          <path d={squarePath(layers.construction.values(), 0.12, 0.76)} fill="none" stroke="#df8a66" strokeWidth="0.8" strokeDasharray="1.5 1" vectorEffect="non-scaling-stroke" />
        </g>
        <rect width="50" height="50" fill="url(#room-grid-lines)" pointerEvents="none" />
      </svg>
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          `plan v${plan?.version ?? "?"}`,
          `RCL${plan?.horizonRcl ?? "?"} horizon`,
          "planned geometry",
          "outlined = built",
          "dashed = construction",
        ].map((label) => <Badge key={label} variant="outline" className="text-[0.68rem] text-muted-foreground">{label}</Badge>)}
      </div>
    </>
  );
}

const qualityTone = (quality?: FspmQuality) => {
  if (!quality) return "border-white/10 text-muted-foreground";
  if (quality.state === "healthy") return "border-emerald-400/20 bg-emerald-400/5 text-emerald-300";
  if (quality.state === "watch") return "border-amber-400/20 bg-amber-400/5 text-amber-300";
  return "border-red-400/20 bg-red-400/5 text-red-300";
};

const trendGlyph = (trend?: FspmQuality["trend"]) => {
  if (trend === "improving") return "↑";
  if (trend === "declining") return "↓";
  if (trend === "stable") return "→";
  return "•";
};

function HealthBadge({ quality }: { quality?: FspmQuality }) {
  return (
    <Badge variant="outline" className={`gap-1.5 capitalize ${qualityTone(quality)}`}>
      <span aria-hidden="true">{trendGlyph(quality?.trend)}</span>
      {quality ? `${quality.score} · ${quality.state}` : "unmeasured"}
    </Badge>
  );
}

function TaskQi({ task }: { task: FspmTask }) {
  const qi = task.qi;
  if (!qi) return <Badge variant="outline" className="text-muted-foreground">QI pending</Badge>;
  const tone = qi.score >= 1 ? "border-emerald-400/20 text-emerald-300" : "border-amber-400/20 text-amber-300";
  return <Badge variant="outline" className={`font-mono ${tone}`}>QI {qi.score.toFixed(3)} · {qi.ratedActivities}/{qi.totalActivities}</Badge>;
}

function TaskCard({ task }: { task: FspmTask }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/15 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Task</div>
          <div className="mt-1 truncate text-sm font-medium text-foreground">{task.title ?? task.taskKey ?? task.id}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="capitalize text-muted-foreground">{task.status}</Badge>
          <TaskQi task={task} />
        </div>
      </div>

      {(task.kpiMetric || task.recentActivities?.length) ? (
        <details className="group mt-3 rounded-lg border border-white/7 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer list-none font-medium text-foreground/80 marker:hidden">
            <span className="flex items-center justify-between gap-3">
              <span>Measurement detail</span>
              <span className="text-muted-foreground transition group-open:rotate-45" aria-hidden="true">+</span>
            </span>
          </summary>
          <div className="mt-3 grid gap-3 border-t border-white/7 pt-3">
            {task.kpiMetric ? (
              <div className="grid gap-1.5 leading-5">
                <div className="font-medium text-foreground/80">KPI · {task.kpiMetric.metric}</div>
                <div><span className="text-emerald-300">Exceptional 1.5:</span> {task.kpiMetric.exceptional}</div>
                <div><span className="text-foreground/80">Satisfactory 1.0:</span> {task.kpiMetric.satisfactory}</div>
                <div><span className="text-amber-300">Unsatisfactory 0.5:</span> {task.kpiMetric.unsatisfactory}</div>
              </div>
            ) : null}
            {task.recentActivities?.length ? (
              <div className="grid gap-1.5 text-[0.68rem]">
                <div className="font-medium text-foreground/80">Recent activity</div>
                {task.recentActivities.slice(-4).reverse().map((activity) => (
                  <div key={activity.activityId} className="flex flex-wrap items-center justify-between gap-2">
                    <span>{activity.activityType} · {activity.actor}{activity.outcome ? ` · ${activity.outcome.actual}/${activity.outcome.target} ${activity.outcome.unit}` : ""}</span>
                    <span className="font-mono capitalize">{activity.rating}{activity.value === null ? "" : ` ${activity.value.toFixed(1)}`}{activity.outcome ? ` · ${Math.round(activity.outcome.utilization * 100)}%` : ""}</span>
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
  const history = fspm.p3 ? (fspm.p3History ?? []) : (fspm.contractHistory ?? []);
  const authority = fspm.p3 ? "Portfolio/P3" : "legacy contract";
  if (!history.length) return <div className="text-xs text-muted-foreground">Trend history has not accumulated yet.</div>;
  const min = Math.min(...history.map((sample) => sample.score), 0);
  const max = Math.max(...history.map((sample) => sample.score), 100);
  const range = Math.max(1, max - min);

  return (
    <div>
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`${authority} quality history with ${history.length} samples`}>
        {history.map((sample) => (
          <div key={sample.tick} className="min-w-2 flex-1 rounded-t-sm bg-primary/70" style={{ height: `${Math.max(8, ((sample.score - min) / range) * 100)}%` }} title={`tick ${sample.tick}: ${sample.score} ${sample.state}`} />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.62rem] text-muted-foreground">
        <span>{history.length} sample{history.length === 1 ? "" : "s"}</span>
        <span>latest {history.at(-1)?.score ?? "—"}</span>
      </div>
    </div>
  );
}

function FspmOverview({ fspm }: { fspm: FspmColonySummary | null }) {
  if (!fspm) {
    return (
      <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
        <CardHeader><CardTitle as="h2" className="text-xl">Colony health</CardTitle><CardDescription>FSPM quality has not reached the latest sanitized snapshot yet.</CardDescription></CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="lab-panel min-w-0 rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="border-b border-white/8 pb-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em] text-primary">FSPM operating model</CardDescription>
              <CardTitle as="h2" className="mt-2 text-2xl">{fspm.p3?.name ?? fspm.legacyProgram?.title ?? `Room ${fspm.roomName}`}</CardTitle>
              <CardDescription className="mt-1">Portfolio/P3 → Requirement → Deliverable → Task → measured Activity.</CardDescription>
            </div>
            <HealthBadge quality={fspm.p3?.quality ?? fspm.contract.quality} />
          </div>
        </CardHeader>
        <CardContent className="pt-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {fspm.requirements.map((requirement) => (
              <div key={requirement.id} className="rounded-xl border border-white/8 bg-black/10 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Requirement</div>
                    <div className="mt-1 truncate text-sm font-medium">{requirement.title ?? requirement.domain ?? requirement.id}</div>
                  </div>
                  <HealthBadge quality={requirement.quality} />
                </div>
                <div className="mt-3 text-xs capitalize text-muted-foreground">{requirement.status}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="lab-panel min-w-0 rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="pb-3">
          <CardDescription className="text-[0.68rem] uppercase tracking-[0.16em]">Portfolio trend</CardDescription>
          <CardTitle as="h2" className="text-lg">Bounded health window</CardTitle>
        </CardHeader>
        <CardContent>
          <PortfolioTrend fspm={fspm} />
          <div className="mt-4 border-t border-white/7 pt-3 text-xs leading-5 text-muted-foreground">Task QI uses FSPM multipliers. Deeper Portfolio/P3 mechanics live in the FSPM tab.</div>
        </CardContent>
      </Card>
    </div>
  );
}

function FspmHierarchy({ fspm }: { fspm: FspmColonySummary }) {
  return (
    <div className="grid gap-3">
      {fspm.requirements.map((requirement, requirementIndex) => {
        const deliverables = fspm.deliverables.filter((deliverable) => deliverable.requirementId === requirement.id || (!deliverable.requirementId && deliverable.domain === requirement.domain));
        return (
          <details key={requirement.id} open={requirementIndex === 0} className="group rounded-2xl border border-white/8 bg-card/45">
            <summary className="cursor-pointer list-none p-4 marker:hidden">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/8 bg-black/15 text-muted-foreground transition group-open:rotate-45" aria-hidden="true">+</span>
                  <div className="min-w-0">
                    <div className="text-[0.62rem] uppercase tracking-[0.18em] text-primary">Requirement</div>
                    <div className="mt-0.5 truncate text-base font-medium">{requirement.title ?? requirement.domain ?? requirement.id}</div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline" className="capitalize text-muted-foreground">{requirement.status}</Badge>
                  <HealthBadge quality={requirement.quality} />
                  <Badge variant="outline" className="text-muted-foreground">{deliverables.length} deliverable{deliverables.length === 1 ? "" : "s"}</Badge>
                </div>
              </div>
            </summary>
            <div className="grid gap-3 border-t border-white/8 p-4 pt-3">
              {deliverables.map((deliverable) => {
                const tasks = fspm.tasks.filter((task) => task.deliverableId === deliverable.id || (!task.deliverableId && task.domain === deliverable.domain));
                return (
                  <details key={deliverable.id} className="group/deliverable rounded-xl border border-white/8 bg-black/10">
                    <summary className="cursor-pointer list-none p-3 marker:hidden">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="text-muted-foreground transition group-open/deliverable:rotate-45" aria-hidden="true">+</span>
                          <div className="min-w-0">
                            <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Deliverable</div>
                            <div className="mt-0.5 truncate text-sm font-medium">{deliverable.title ?? deliverable.domain ?? deliverable.id}</div>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Badge variant="outline" className="capitalize text-muted-foreground">{deliverable.status}</Badge>
                          <Badge variant="outline" className="text-muted-foreground">{tasks.length} task{tasks.length === 1 ? "" : "s"}</Badge>
                        </div>
                      </div>
                    </summary>
                    <div className="grid gap-2 border-t border-white/7 p-3">
                      {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} />) : <div className="rounded-lg border border-dashed border-white/8 p-3 text-xs text-muted-foreground">No materialized Tasks yet.</div>}
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

export function ObservabilityDashboard({ snapshot, benchmark, provenance, experiments, fspm, activeView }: ObservabilityDashboardProps) {
  const controller = snapshot?.colony?.controller;
  const energy = snapshot?.colony?.energy;

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      hint: "health & orientation",
      href: "/?view=overview",
      content: <FspmOverview fspm={fspm} />,
    },
    {
      id: "colony",
      label: "Colony",
      hint: "room & movement",
      href: "/?view=colony",
      content: (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.65fr)]">
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5"><CardTitle as="h2" className="text-xl">Room plan</CardTitle><CardDescription className="mt-1">Planned geometry overlaid with built state.</CardDescription></CardHeader>
            <CardContent className="pt-6"><RoomGrid snapshot={snapshot} /></CardContent>
          </Card>
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5"><CardTitle as="h2" className="text-xl">Movement strategy</CardTitle><CardDescription className="mt-1">Current runtime routing posture.</CardDescription></CardHeader>
            <CardContent className="space-y-5 pt-6 text-sm leading-6 text-muted-foreground">
              <p>Native Screeps pathing owns routing, with traffic-aware cached movement, congestion detection, and bounded swap/repath fallback.</p>
              <div className="rounded-xl border border-primary/15 bg-primary/5 p-4"><div className="text-[0.68rem] uppercase tracking-[0.16em] text-primary">Measurement spine</div><div className="mt-1 text-sm font-medium text-foreground">Activities feed Task QI</div></div>
            </CardContent>
          </Card>
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
              <CardTitle as="h2" className="text-xl">PPAE+O runtime profile</CardTitle>
              <CardDescription className="mt-1">{benchmark ? `${benchmark.benchmarkName} · ${formatUtcTimestamp(benchmark.capturedAt)}` : "Latest timestamped benchmark evidence."}</CardDescription>
            </CardHeader>
            <CardContent className="pt-6"><RuntimeBenchmark benchmark={benchmark} /></CardContent>
          </Card>
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5">
              <div className="flex items-start justify-between gap-4"><div><CardTitle as="h2" className="text-xl">Experiment history</CardTitle><CardDescription className="mt-1">Completed experiments from the authoritative read model.</CardDescription></div><Badge variant="outline" className="text-muted-foreground">{experiments.length} complete</Badge></div>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="grid max-h-[420px] gap-2 overflow-auto pr-1">
                {experiments.length ? experiments.map((experiment) => (
                  <details key={experiment.experiment_key} className="group rounded-xl border border-white/7 bg-black/10 transition open:bg-white/[0.02]">
                    <summary className="cursor-pointer list-none p-4 marker:hidden">
                      <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center"><div className="min-w-0 truncate"><code className="text-primary">{experiment.experiment_key}</code> <span className="text-muted-foreground">·</span> {experiment.name}</div><span className="text-muted-foreground transition group-open:rotate-45" aria-hidden="true">+</span></div>
                    </summary>
                    <div className="border-t border-white/7 px-4 pb-4 pt-3 text-xs text-muted-foreground">
                      {experiment.completed_at ? <div>Completed {experiment.completed_at}</div> : null}
                      {experiment.runtime_sha ? <div className="mt-1 font-mono">runtime {experiment.runtime_sha}</div> : null}
                    </div>
                  </details>
                )) : <div className="rounded-xl border border-dashed border-white/8 p-6 text-sm text-muted-foreground">No completed experiment rows yet.</div>}
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
        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
          <CardHeader className="border-b border-white/8 pb-5"><CardTitle as="h2" className="text-xl">Execution hierarchy</CardTitle><CardDescription className="mt-1">Expand only the requirement, deliverable, and task detail you need.</CardDescription></CardHeader>
          <CardContent className="pt-5"><FspmHierarchy fspm={fspm} /></CardContent>
        </Card>
      ) : <FspmOverview fspm={null} />,
    },
  ];

  return (
    <>
      <DataProvenance provenance={provenance} />

      <section aria-label="Colony at a glance" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metricCard("Colony", snapshot?.room ?? "—", `${snapshot?.target ?? "ptr"} / ${snapshot?.shard ?? "shard3"}`)}
        {metricCard("RCL", controller?.level ?? "—", controller?.progressTotal ? `${controller.progress ?? 0} / ${controller.progressTotal}` : "controller progress unavailable")}
        {metricCard("Room energy", energy ? `${energy.available ?? 0} / ${energy.capacity ?? 0}` : "—", "available / capacity")}
        {metricCard("Workforce", snapshot?.colony?.creeps ?? "—", "visible creeps")}
      </section>

      <Tabs tabs={tabs} activeTab={activeView} ariaLabel="Observability views" />
    </>
  );
}
