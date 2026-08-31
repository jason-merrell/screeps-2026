import { LabShell } from "@/components/lab-shell";
import { ObservabilityDashboard } from "@/components/observability-dashboard";
import { Badge } from "@/components/ui/badge";
import { loadControlPlane } from "@/lib/control-plane";
import { unavailableControlPlaneProvenance } from "@/lib/data-trust";

export const dynamic = "force-dynamic";

type HomeProps = {
  searchParams: Promise<{ view?: string }>;
};

type ObservabilityView = "overview" | "colony" | "runtime" | "fspm";

export default async function Home({ searchParams }: HomeProps) {
  const params = await searchParams;
  const activeView: ObservabilityView =
    params.view === "colony" ||
    params.view === "runtime" ||
    params.view === "fspm"
      ? params.view
      : "overview";
  let controlPlane: Awaited<ReturnType<typeof loadControlPlane>> | null = null;
  try {
    controlPlane = await loadControlPlane();
  } catch {
    controlPlane = null;
  }

  const snapshot = controlPlane?.snapshot ?? null;
  const benchmark = controlPlane?.benchmark ?? null;
  const experiments = controlPlane?.experiments ?? [];
  const provenance =
    controlPlane?.provenance ?? unavailableControlPlaneProvenance();
  const provenanceClassName = {
    fresh: "w-fit border-emerald-400/20 px-3 py-1.5 text-emerald-300",
    stale: "w-fit border-amber-400/20 px-3 py-1.5 text-amber-300",
    partial: "w-fit border-orange-400/20 px-3 py-1.5 text-orange-300",
    fallback: "w-fit border-white/10 px-3 py-1.5 text-muted-foreground",
    error: "w-fit border-red-400/20 px-3 py-1.5 text-red-300",
  }[provenance.state];
  const fspm =
    snapshot?.runtimeTrace?.fspm?.colonies?.find(
      (colony) => colony.roomName === snapshot?.room,
    ) ??
    snapshot?.runtimeTrace?.fspm?.colonies?.[0] ??
    null;

  return (
    <LabShell
      active="observability"
      eyebrow="remote experimentation control plane"
      title="Colony observability"
      description="Start with colony health, then drill into room behavior, runtime performance, or the FSPM execution chain only when you need it."
      status={
        <Badge variant="outline" className={provenanceClassName}>
          <span className="mr-2 h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_12px_currentColor]" />
          Telemetry evidence · {provenance.label}
        </Badge>
      }
    >
      <ObservabilityDashboard
        snapshot={snapshot}
        benchmark={benchmark}
        provenance={provenance}
        experiments={experiments}
        fspm={fspm}
        activeView={activeView}
      />

      <div className="mt-6 flex flex-col justify-between gap-2 border-t border-white/8 pt-5 text-xs text-muted-foreground sm:flex-row">
        <span>
          Supabase evidence is evaluated per stream; persisted and fallback
          values are never blended.
        </span>
        <span>GitHub issue #5 remains compatibility ingress only.</span>
      </div>
    </LabShell>
  );
}
