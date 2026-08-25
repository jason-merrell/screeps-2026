import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { benchmarkFallback, loadControlPlane, type BenchmarkMetrics, type Point, type Snapshot } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

const phases: Array<keyof BenchmarkMetrics> = ["perception", "economy", "arbitration", "execution", "observability"];

function metricCard(label: string, value: string | number, detail: string) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardDescription className="text-[0.7rem] uppercase tracking-[0.14em]">{label}</CardDescription>
        <CardTitle className="text-3xl tracking-tight">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{detail}</CardContent>
    </Card>
  );
}

function CpuBars({ metrics }: { metrics: BenchmarkMetrics }) {
  const max = Math.max(...Object.values(metrics), 1);
  return (
    <div className="grid gap-3">
      {phases.map((phase) => (
        <div key={phase} className="grid grid-cols-[92px_1fr_64px] items-center gap-3 text-sm text-muted-foreground">
          <span>{phase}</span>
          <div className="h-2 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-emerald-400"
              style={{ width: `${Math.max(2, (metrics[phase] / max) * 100)}%` }}
            />
          </div>
          <span className="text-right font-mono text-xs">{metrics[phase].toFixed(3)}</span>
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
      <div className="mt-3 flex flex-wrap gap-2">
        {[
          `plan v${plan?.version ?? "?"}`,
          `RCL${plan?.horizonRcl ?? "?"} horizon`,
          "planned geometry",
          "outlined = built",
          "dashed = construction",
        ].map((label) => (
          <Badge key={label} variant="outline" className="text-muted-foreground">{label}</Badge>
        ))}
      </div>
    </>
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

  return (
    <main className="mx-auto w-[min(1440px,calc(100vw-32px))] py-8 pb-16">
      <header className="mb-6 flex flex-col items-start justify-between gap-6 md:flex-row md:items-end">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-muted-foreground">Remote experimentation control plane</div>
          <h1 className="mt-1 text-5xl font-bold tracking-[-0.06em] md:text-7xl">Screeps Lab</h1>
        </div>
        <Badge variant="outline" className="px-3 py-1.5 text-sky-300">Read-only observability</Badge>
      </header>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="lg:col-span-3">{metricCard("Colony", snapshot?.room ?? "W39S23", `${snapshot?.target ?? "ptr"} / ${snapshot?.shard ?? "shard3"}`)}</div>
        <div className="lg:col-span-3">{metricCard("RCL", controller?.level ?? "—", controller?.progressTotal ? `${controller.progress ?? 0} / ${controller.progressTotal}` : "controller progress unavailable")}</div>
        <div className="lg:col-span-3">{metricCard("Room energy", energy ? `${energy.available ?? 0} / ${energy.capacity ?? 0}` : "—", "available / capacity")}</div>
        <div className="lg:col-span-3">{metricCard("Workforce", snapshot?.colony?.creeps ?? "—", "visible creeps")}</div>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>PPAE benchmark</CardTitle>
            <CardDescription>{controlPlane?.sourceHealthy ? "live from Supabase control plane" : "bundled baseline while control plane is unavailable"}</CardDescription>
          </CardHeader>
          <CardContent><CpuBars metrics={metrics} /></CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle>Movement</CardTitle>
            <CardDescription>Current routing strategy</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <p>Native Screeps pathing owns routing, with traffic-aware cached movement, congestion detection, and bounded swap/repath fallback.</p>
            <Badge variant="outline" className="text-emerald-300">next target: burst pathfinding cost</Badge>
          </CardContent>
        </Card>

        <Card className="lg:col-span-5">
          <CardHeader><CardTitle>Room plan</CardTitle></CardHeader>
          <CardContent><RoomGrid snapshot={snapshot} /></CardContent>
        </Card>

        <Card className="lg:col-span-7">
          <CardHeader>
            <CardTitle>Experiment history</CardTitle>
            <CardDescription>Completed experiments from the Supabase read model</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid max-h-[320px] gap-3 overflow-auto">
              {experiments.length ? experiments.map((experiment) => (
                <div key={experiment.experiment_key} className="rounded-lg border bg-background/30 p-3">
                  <div><code className="text-emerald-300">{experiment.experiment_key}</code> · {experiment.name}</div>
                  <div className="mt-1 text-sm text-muted-foreground">{[experiment.runtime_sha, experiment.completed_at].filter(Boolean).join(" · ")}</div>
                </div>
              )) : <div className="text-sm italic text-muted-foreground">No completed experiment rows yet.</div>}
            </div>
          </CardContent>
        </Card>
      </section>

      <p className="mt-5 text-xs text-muted-foreground">Data source: Supabase sanitized read model. GitHub issue #5 is legacy compatibility ingress only.</p>
    </main>
  );
}
