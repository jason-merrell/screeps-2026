import { LabShell } from "@/components/lab-shell";
import { ObservabilityDashboard } from "@/components/observability-dashboard";
import { Badge } from "@/components/ui/badge";
import { benchmarkFallback, loadControlPlane } from "@/lib/control-plane";

export const dynamic = "force-dynamic";

export default async function Home() {
  let controlPlane = null;
  try {
    controlPlane = await loadControlPlane();
  } catch {
    controlPlane = null;
  }

  const snapshot = controlPlane?.snapshot ?? null;
  const metrics = controlPlane?.metrics ?? benchmarkFallback;
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
      description="Start with colony health, then drill into room behavior, runtime performance, or the FSPM execution chain only when you need it."
      status={
        <Badge variant="outline" className="w-fit border-emerald-400/20 px-3 py-1.5 text-emerald-300">
          <span className="mr-2 h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_12px_currentColor]" />
          {controlPlane?.sourceHealthy ? "Supabase live" : "Baseline fallback"}
        </Badge>
      }
    >
      <ObservabilityDashboard snapshot={snapshot} metrics={metrics} experiments={experiments} fspm={fspm} />

      <div className="mt-6 flex flex-col justify-between gap-2 border-t border-white/8 pt-5 text-xs text-muted-foreground sm:flex-row">
        <span>Data source: Supabase sanitized read model.</span>
        <span>GitHub issue #5 remains compatibility ingress only.</span>
      </div>
    </LabShell>
  );
}
