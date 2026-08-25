import { LabShell } from "@/components/lab-shell";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  benchmarkFallback,
  loadControlPlane,
  type BenchmarkMetrics,
  type FspmColonySummary,
  type FspmQuality,
  type FspmTask,
  type Point,
  type Snapshot,
} from "@/lib/control-plane";

export const dynamic = "force-dynamic";

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
            <div
              className="h-full rounded-full bg-primary/80"
              style={{ width: `${Math.max(2, (metrics[phase] / max) * 100)}%` }}
            />
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
  for (const structure of snapshot?.colony?.structures ?? []) {
    mark(structure, "actual-structure", `built ${structure.type ?? "structure"}`);
  }
  for (const site of snapshot?.colony?.constructionSites ?? []) {
    mark(site, "construction", `construction ${site.structureType ?? "site"}`);
  }

  const cells = classes.map((classNames, index) => ({
    id: `${index % 50}:${Math.floor(index / 50)}`,
    className: [...classNames].join(" "),
    title: titles[index]?.join("; ") || undefined,
  }));

  return (
    <>
      <div className="room-grid" role="img" aria-label="50 by 50 Screeps room grid">
        {cells.map((cell) => (
          <span key={cell.id} className={cell.className} title={cell.title} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {[
          `plan v${plan?.version ?? "?"}`,
          `RCL${plan?.horizonRcl ?? "?"} horizon`,
          "planned geometry",
          "outlined = built",
          "dashed = construction",
        ].map((label) => (
          <Badge key={label} variant="outline" className="text-[0.68rem] text-muted-foreground">
            {label}
          </Badge>
        ))}
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
  if (!qi) {
    return <Badge variant="outline" className="text-muted-foreground">QI pending</Badge>;
  }
  const tone = qi.score >= 1 ? "border-emerald-400/20 text-emerald-300" : "border-amber-400/20 text-amber-300";
  return (
    <Badge variant="outline" className={`font-mono ${tone}`}>
      QI {qi.score.toFixed(3)} · {qi.ratedActivities}/{qi.totalActivities} rated
    </Badge>
  );
}

function TaskCard({ task }: { task: FspmTask }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/15 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Task</div>
          <div className="mt-1 text-sm font-medium text-foreground">{task.title ?? task.taskKey ?? task.id}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline" className="capitalize text-muted-foreground">{task.status}</Badge>
          <TaskQi task={task} />
        </div>
      </div>

      {task.kpiMetric ? (
        <details className="mt-3 rounded-lg border border-white/7 bg-black/10 px-3 py-2 text-xs text-muted-foreground">
          <summary className="cursor-pointer font-medium text-foreground/80">KPI · {task.kpiMetric.metric}</summary>
          <div className="mt-2 grid gap-1.5 leading-5">
            <div><span className="text-emerald-300">Exceptional 1.5:</span> {task.kpiMetric.exceptional}</div>
            <div><span className="text-foreground/80">Satisfactory 1.0:</span> {task.kpiMetric.satisfactory}</div>
            <div><span className="text-amber-300">Unsatisfactory 0.5:</span> {task.kpiMetric.unsatisfactory}</div>
          </div>
        </details>
      ) : null}

      {task.recentActivities?.length ? (
        <div className="mt-3 grid gap-1.5 border-t border-white/7 pt-3 text-[0.68rem] text-muted-foreground">
          {task.recentActivities.slice(-4).reverse().map((activity) => (
            <div key={activity.activityId} className="flex flex-wrap items-center justify-between gap-2">
              <span>{activity.activityType} · {activity.actor}{activity.outcome ? ` · ${activity.outcome.actual}/${activity.outcome.target} ${activity.outcome.unit}` : ""}</span>
              <span className="font-mono capitalize">{activity.rating}{activity.value === null ? "" : ` ${activity.value.toFixed(1)}`}{activity.outcome ? ` · ${Math.round(activity.outcome.utilization * 100)}%` : ""}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FspmHierarchy({ fspm }: { fspm: FspmColonySummary }) {
  return (
    <div className="grid gap-4">
      {fspm.requirements.map((requirement) => {
        const deliverables = fspm.deliverables.filter(
          (deliverable) =>
            deliverable.requirementId === requirement.id ||
            (!deliverable.requirementId && deliverable.domain === requirement.domain),
        );
        return (
          <section key={requirement.id} className="rounded-2xl border border-white/8 bg-black/10 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-[0.62rem] uppercase tracking-[0.18em] text-primary">Requirement</div>
                <div className="mt-1 text-base font-medium text-foreground">{requirement.title ?? requirement.domain ?? requirement.id}</div>
              </div>
              <div className="flex gap-2">
                <Badge variant="outline" className="capitalize text-muted-foreground">{requirement.status}</Badge>
                <HealthBadge quality={requirement.quality} />
              </div>
            </div>

            <div className="mt-4 grid gap-3">
              {deliverables.map((deliverable) => {
                const tasks = fspm.tasks.filter(
                  (task) =>
                    task.deliverableId === deliverable.id ||
                    (!task.deliverableId && task.domain === deliverable.domain),
                );
                return (
                  <div key={deliverable.id} className="rounded-xl border border-white/8 bg-card/25 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">Deliverable</div>
                        <div className="mt-1 text-sm font-medium text-foreground">{deliverable.title ?? deliverable.domain ?? deliverable.id}</div>
                      </div>
                      <Badge variant="outline" className="capitalize text-muted-foreground">{deliverable.status}</Badge>
                    </div>
                    <div className="mt-3 grid gap-2">
                      {tasks.length ? tasks.map((task) => <TaskCard key={task.id} task={task} />) : (
                        <div className="rounded-lg border border-dashed border-white/8 p-3 text-xs text-muted-foreground">No materialized Tasks yet.</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
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
          <div
            key={sample.tick}
            className="min-w-2 flex-1 rounded-t-sm bg-primary/70"
            style={{ height: `${Math.max(8, ((sample.score - min) / range) * 100)}%` }}
            title={`tick ${sample.tick}: ${sample.score} ${sample.state}`}
          />
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[0.62rem] text-muted-foreground">
        <span>{history.length} sample{history.length === 1 ? "" : "s"}</span>
        <span>latest {history.at(-1)?.score ?? "—"}</span>
      </div>
    </div>
  );
}

function ExecutiveHealth({ fspm }: { fspm: FspmColonySummary | null }) {
  if (!fspm) {
    return (
      <Card className="lab-panel rounded-2xl border-white/8 bg-card/65 lg:col-span-12">
        <CardHeader>
          <CardTitle className="text-xl">Colony health</CardTitle>
          <CardDescription>FSPM quality has not reached the latest sanitized snapshot yet.</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <Card className="lab-panel overflow-hidden rounded-2xl border-white/8 bg-card/65 lg:col-span-12">
      <CardHeader className="border-b border-white/8 pb-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
          <div>
            <div className="text-[0.68rem] uppercase tracking-[0.18em] text-primary">FSPM operating model</div>
            <CardTitle className="mt-2 text-2xl">{fspm.program?.title ?? `Room ${fspm.roomName}`}</CardTitle>
            <CardDescription className="mt-1">
              {fspm.program ? "Service Program · " : ""}Requirement → Deliverable → Task → measured Activity.
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {fspm.program ? <Badge variant="outline" className="capitalize text-muted-foreground">service program {fspm.program.status}</Badge> : null}
            <Badge variant="outline" className="capitalize text-muted-foreground">contract {fspm.contract.status}</Badge>
            <HealthBadge quality={fspm.contract.quality} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-5 pt-6 lg:grid-cols-[minmax(0,1fr)_240px]">
        <FspmHierarchy fspm={fspm} />
        <div className="rounded-2xl border border-white/8 bg-black/10 p-4">
          <div className="text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">Contract trend</div>
          <div className="mt-1 text-sm font-medium text-foreground">Bounded health window</div>
          <div className="mt-5"><ContractTrend fspm={fspm} /></div>
          <div className="mt-4 border-t border-white/7 pt-3 text-xs leading-5 text-muted-foreground">
            Task QI uses FSPM multipliers. Deliverable QI remains intentionally unset until governed Task Weights exist.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default async function Home() {
  let controlPlane = null;
  try {
    controlPlane = await loadControlPlane();
  } catch {
    controlPlane = null;
  }

  const snapshot = controlPlane?.snapshot ?? null;
  const metrics = controlPlane?.metrics ?? benchmarkFallback;
  const controller = snapshot?.colony?.controller;
  const energy = snapshot?.colony?.energy;
  const experiments = controlPlane?.experiments ?? [];
  const fspm =
    snapshot?.runtimeTrace?.fspm?.colonies?.find((colony) => colony.roomName === snapshot?.room) ??
    snapshot?.runtimeTrace?.fspm?.colonies?.[0] ??
    null;

  return (
    <LabShell
      active="observability"
      eyebrow="remote experimentation control plane"
      title="Colony observability"
      description="FSPM execution quality, colony state, room plan, runtime profile, and experiment history."
      status={
        <Badge variant="outline" className="w-fit border-emerald-400/20 px-3 py-1.5 text-emerald-300">
          <span className="mr-2 h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_currentColor]" />
          {controlPlane?.sourceHealthy ? "Supabase live" : "Baseline fallback"}
        </Badge>
      }
    >
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <ExecutiveHealth fspm={fspm} />

        <div className="lg:col-span-3">{metricCard("Colony", snapshot?.room ?? "W39S23", `${snapshot?.target ?? "ptr"} / ${snapshot?.shard ?? "shard3"}`)}</div>
        <div className="lg:col-span-3">{metricCard("RCL", controller?.level ?? "—", controller?.progressTotal ? `${controller.progress ?? 0} / ${controller.progressTotal}` : "controller progress unavailable")}</div>
        <div className="lg:col-span-3">{metricCard("Room energy", energy ? `${energy.available ?? 0} / ${energy.capacity ?? 0}` : "—", "available / capacity")}</div>
        <div className="lg:col-span-3">{metricCard("Workforce", snapshot?.colony?.creeps ?? "—", "visible creeps")}</div>

        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65 lg:col-span-7">
          <CardHeader className="border-b border-white/8 pb-5">
            <CardTitle className="text-xl">PPAE runtime profile</CardTitle>
            <CardDescription className="mt-1">Per-phase CPU from the latest benchmark sample.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6"><CpuBars metrics={metrics} /></CardContent>
        </Card>

        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65 lg:col-span-5">
          <CardHeader className="border-b border-white/8 pb-5">
            <CardTitle className="text-xl">Movement strategy</CardTitle>
            <CardDescription className="mt-1">Current runtime routing posture.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 pt-6 text-sm leading-6 text-muted-foreground">
            <p>Native Screeps pathing owns routing, with traffic-aware cached movement, congestion detection, and bounded swap/repath fallback.</p>
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <div className="text-[0.68rem] uppercase tracking-[0.16em] text-primary">Measurement spine</div>
              <div className="mt-1 text-sm font-medium text-foreground">Activities now feed Task QI</div>
            </div>
          </CardContent>
        </Card>

        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65 lg:col-span-5">
          <CardHeader className="border-b border-white/8 pb-5">
            <CardTitle className="text-xl">Room plan</CardTitle>
            <CardDescription className="mt-1">Planned geometry overlaid with built state.</CardDescription>
          </CardHeader>
          <CardContent className="pt-6"><RoomGrid snapshot={snapshot} /></CardContent>
        </Card>

        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65 lg:col-span-7">
          <CardHeader className="border-b border-white/8 pb-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="text-xl">Experiment history</CardTitle>
                <CardDescription className="mt-1">Completed experiments from the authoritative read model.</CardDescription>
              </div>
              <Badge variant="outline" className="text-muted-foreground">{experiments.length} complete</Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-5">
            <div className="grid max-h-[340px] gap-2 overflow-auto pr-1">
              {experiments.length ? experiments.map((experiment) => (
                <div key={experiment.experiment_key} className="group rounded-xl border border-white/7 bg-black/10 p-4 transition hover:border-white/12 hover:bg-white/[0.025]">
                  <div className="flex flex-col justify-between gap-1 sm:flex-row sm:items-center">
                    <div><code className="text-primary">{experiment.experiment_key}</code> <span className="text-muted-foreground">·</span> {experiment.name}</div>
                    {experiment.completed_at ? <div className="text-xs text-muted-foreground">{experiment.completed_at}</div> : null}
                  </div>
                  {experiment.runtime_sha ? <div className="mt-2 font-mono text-[0.68rem] text-muted-foreground">runtime {experiment.runtime_sha}</div> : null}
                </div>
              )) : <div className="rounded-xl border border-dashed border-white/8 p-6 text-sm text-muted-foreground">No completed experiment rows yet.</div>}
            </div>
          </CardContent>
        </Card>
      </section>

      <div className="mt-6 flex flex-col justify-between gap-2 border-t border-white/8 pt-5 text-xs text-muted-foreground sm:flex-row">
        <span>Data source: Supabase sanitized read model.</span>
        <span>GitHub issue #5 remains compatibility ingress only.</span>
      </div>
    </LabShell>
  );
}
