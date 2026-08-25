import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import type {
  BenchmarkMetrics,
  FspmColonySummary,
  FspmQuality,
  FspmTask,
  Point,
  Snapshot,
} from "@/lib/control-plane";

const phases: Array<keyof BenchmarkMetrics> = [
  "perception",
  "economy",
  "arbitration",
  "execution",
  "observability",
];

function metricCard(label: string, value: string | number, detail: string) {
  return (
    <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
      <CardHeader className="pb-3">
        <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em]">{label}</CardDescription>
        <CardTitle className="lab-stat-value text-3xl tracking-[-0.035em]">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs leading-5 text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function CpuBars({ metrics }: { metrics: BenchmarkMetrics }) {
  const max = Math.max(...Object.values(metrics), 1);
  return (
    <div className="grid gap-4">
      {phases.map((phase) => (
        <div key={phase} className="grid grid-cols-[88px_1fr_64px] items-center gap-3 text-sm text-muted-foreground">
          <span className="capitalize">{phase}</span>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
            <div className="h-full rounded-full bg-primary/80" style={{ width: `${Math.max(2, (metrics[phase] / max) * 100)}%` }} />
          </div>
          <span className="text-right font-mono text-xs text-foreground/70">{metrics[phase].toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

function RoomGrid({ snapshot }: { snapshot: Snapshot | null }) {
  const classes = Array.from({ length: 2500 }, () => new Set<string>(["room-cell"]));
  const titles = Array.from({ length: 2500 }, () => [] as string[]);
  const mark = (point: Point | null | undefined, className: string, title: string) => {
    if (!point || !Number.isInteger(point.x) || !Number.isInteger(point.y)) return;
    if (point.x < 0 || point.x > 49 || point.y < 0 || point.y > 49) return;
    const index = point.y * 50 + point.x;
    classes[index]?.add(className);
    titles[index]?.push(title);
  };

  const plan = snapshot?.roomPlan;
  for (const road of plan?.roads ?? []) mark(road, "planned-road", "planned road");
  for (const structure of plan?.structures ?? []) {
    const className =
      structure.structureType === "tower"
        ? "planned-tower"
        : structure.structureType === "container"
          ? "planned-container"
          : "planned-extension";
    mark(structure, className, `planned ${structure.structureType ?? "structure"}`);
  }
  mark(plan?.anchors?.spawn, "anchor-spawn", "spawn anchor");
  mark(plan?.anchors?.hub, "anchor-hub", "logistics hub");
  mark(plan?.anchors?.controller, "anchor-controller", "controller");
  for (const source of plan?.anchors?.sources ?? []) {
    mark(source, "anchor-source", "source");
    mark(source.container, "planned-container", "source container");
  }
  for (const structure of snapshot?.colony?.structures ?? []) mark(structure, "actual-structure", `built ${structure.type ?? "structure"}`);
  for (const site of snapshot?.colony?.constructionSites ?? []) mark(site, "construction", `construction ${site.structureType ?? "site"}`);

  const cells = classes.map((classNames, index) => ({
    id: `${index % 50}:${Math.floor(index / 50)}`,
    className: [...classNames].join(" "),
    title: titles[index]?.join("; ") || undefined,
  }));

  return (
    <>
      <div className="room-grid" role="img" aria-label="50 by 50 Screeps room grid">
        {cells.map((cell) => <span key={cell.id} className={cell.className} title={cell.title} />)}
      </div>
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

function ContractTrend({ fspm }: { fspm: FspmColonySummary }) {
  const history = fspm.contractHistory ?? [];
  if (!history.length) return <div className="text-xs text-muted-foreground">Trend history has not accumulated yet.</div>;
  const min = Math.min(...history.map((sample) => sample.score), 0);
  const max = Math.max(...history.map((sample) => sample.score), 100);
  const range = Math.max(1, max - min);

  return (
    <div>
      <div className="flex h-16 items-end gap-1" role="img" aria-label={`Contract quality history with ${history.length} samples`}>
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
        <CardHeader><CardTitle className="text-xl">Colony health</CardTitle><CardDescription>FSPM quality has not reached the latest sanitized snapshot yet.</CardDescription></CardHeader>
      </Card>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="border-b border-white/8 pb-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div>
              <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em] text-primary">FSPM operating model</CardDescription>
              <CardTitle className="mt-2 text-2xl">{fspm.program?.title ?? `Room ${fspm.roomName}`}</CardTitle>
              <CardDescription className="mt-1">Requirement → Deliverable → Task → measured Activity.</CardDescription>
            </div>
            <HealthBadge quality={fspm.contract.quality} />
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

      <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="pb-3">
          <CardDescription className="text-[0.68rem] uppercase tracking-[0.16em]">Contract trend</CardDescription>
          <CardTitle className="text-lg">Bounded health window</CardTitle>
        </CardHeader>
        <CardContent>
          <ContractTrend fspm={fspm} />
          <div className="mt-4 border-t border-white/7 pt-3 text-xs leading-5 text-muted-foreground">Task QI uses FSPM multipliers. Deeper contract mechanics live in the FSPM tab.</div>
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
  metrics: BenchmarkMetrics;
  experiments: Experiment[];
  fspm: FspmColonySummary | null;
};

export function ObservabilityDashboard({ snapshot, metrics, experiments, fspm }: ObservabilityDashboardProps) {
  const controller = snapshot?.colony?.controller;
  const energy = snapshot?.colony?.energy;

  const tabs = [
    {
      id: "overview",
      label: "Overview",
      hint: "health & orientation",
      content: <FspmOverview fspm={fspm} />,
    },
    {
      id: "colony",
      label: "Colony",
      hint: "room & movement",
      content: (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(300px,0.65fr)]">
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5"><CardTitle className="text-xl">Room plan</CardTitle><CardDescription className="mt-1">Planned geometry overlaid with built state.</CardDescription></CardHeader>
            <CardContent className="pt-6"><RoomGrid snapshot={snapshot} /></CardContent>
          </Card>
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5"><CardTitle className="text-xl">Movement strategy</CardTitle><CardDescription className="mt-1">Current runtime routing posture.</CardDescription></CardHeader>
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
      content: (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5"><CardTitle className="text-xl">PPAE runtime profile</CardTitle><CardDescription className="mt-1">Per-phase CPU from the latest benchmark sample.</CardDescription></CardHeader>
            <CardContent className="pt-6"><CpuBars metrics={metrics} /></CardContent>
          </Card>
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="border-b border-white/8 pb-5">
              <div className="flex items-start justify-between gap-4"><div><CardTitle className="text-xl">Experiment history</CardTitle><CardDescription className="mt-1">Completed experiments from the authoritative read model.</CardDescription></div><Badge variant="outline" className="text-muted-foreground">{experiments.length} complete</Badge></div>
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
      hint: "contract drill-down",
      content: fspm ? (
        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
          <CardHeader className="border-b border-white/8 pb-5"><CardTitle className="text-xl">Execution hierarchy</CardTitle><CardDescription className="mt-1">Expand only the requirement, deliverable, and task detail you need.</CardDescription></CardHeader>
          <CardContent className="pt-5"><FspmHierarchy fspm={fspm} /></CardContent>
        </Card>
      ) : <FspmOverview fspm={null} />,
    },
  ];

  return (
    <>
      <section aria-label="Colony at a glance" className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {metricCard("Colony", snapshot?.room ?? "—", `${snapshot?.target ?? "ptr"} / ${snapshot?.shard ?? "shard3"}`)}
        {metricCard("RCL", controller?.level ?? "—", controller?.progressTotal ? `${controller.progress ?? 0} / ${controller.progressTotal}` : "controller progress unavailable")}
        {metricCard("Room energy", energy ? `${energy.available ?? 0} / ${energy.capacity ?? 0}` : "—", "available / capacity")}
        {metricCard("Workforce", snapshot?.colony?.creeps ?? "—", "visible creeps")}
      </section>

      <Tabs tabs={tabs} defaultTab="overview" ariaLabel="Observability views" />
    </>
  );
}
