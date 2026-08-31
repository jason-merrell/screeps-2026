import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { enqueueSnapshot } from "@/app/operator/actions";
import { CommandHistoryRefresh } from "@/app/operator/command-history-refresh";
import { LabShell } from "@/components/lab-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OperatorPageProps = {
  searchParams: Promise<{ queued?: string; error?: string; wake?: string; view?: string }>;
};

type CommandEvent = {
  id: number;
  event_type: string;
  detail: Record<string, unknown>;
  occurred_at: string;
};

type CommandRecord = {
  id: string;
  command_key: string;
  command_type: string;
  target: string;
  shard: string | null;
  room_name: string | null;
  status: string;
  requested_at: string;
  claimed_at: string | null;
  claimed_by: string | null;
  completed_at: string | null;
  command_events: CommandEvent[];
};

const ACTIVE_STATUSES = new Set(["pending", "claimed", "executing"]);

function elapsedSeconds(start: string | null, end: string | null) {
  if (!start || !end) return null;
  return Math.max(0, (new Date(end).getTime() - new Date(start).getTime()) / 1000);
}

function formatDuration(seconds: number | null) {
  if (seconds === null) return "—";
  if (seconds < 10) return `${seconds.toFixed(1)}s`;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

function formatTimestamp(value: string) {
  return `${new Date(value).toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  })} UTC`;
}

function statusClasses(status: string) {
  if (status === "succeeded") return "border-emerald-400/20 bg-emerald-400/8 text-emerald-300";
  if (status === "failed" || status === "cancelled") return "border-red-400/20 bg-red-400/8 text-red-300";
  if (status === "executing") return "border-sky-400/20 bg-sky-400/8 text-sky-300";
  if (status === "claimed") return "border-violet-400/20 bg-violet-400/8 text-violet-300";
  return "border-primary/20 bg-primary/8 text-primary";
}

function workerRunId(claimedBy: string | null) {
  const match = claimedBy?.match(/^github:(\d+):/);
  return match?.[1] ?? null;
}

export default async function OperatorPage({ searchParams }: OperatorPageProps) {
  const params = await searchParams;
  const activeView = params.view === "queue" || params.view === "history"
    ? params.view
    : params.queued
      ? "history"
      : "queue";
  const tabHref = (view: "queue" | "history") => {
    const query = new URLSearchParams({ view });
    if (params.queued) query.set("queued", params.queued);
    if (params.error) query.set("error", params.error);
    if (params.wake) query.set("wake", params.wake);
    return `/operator?${query.toString()}`;
  };
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) redirect("/login");

  const { data: membership } = await supabase
    .from("command_operators")
    .select("user_id,label,created_at")
    .eq("user_id", claims.sub)
    .maybeSingle();

  const isOperator = Boolean(membership);
  const commandKey = `lab:${claims.sub}:snapshot:${randomUUID()}`;

  let recentCommands: CommandRecord[] = [];
  if (isOperator) {
    const { data } = await supabase
      .from("commands")
      .select("id,command_key,command_type,target,shard,room_name,status,requested_at,claimed_at,claimed_by,completed_at,command_events(id,event_type,detail,occurred_at)")
      .eq("requested_by", claims.sub)
      .order("requested_at", { ascending: false })
      .limit(12);

    recentCommands = (data ?? []) as CommandRecord[];
  }

  const activeCommands = recentCommands.filter((command) => ACTIVE_STATUSES.has(command.status));
  const terminalCommands = recentCommands.filter((command) => !ACTIVE_STATUSES.has(command.status));
  const succeededCommands = terminalCommands.filter((command) => command.status === "succeeded");
  const claimLatencies = recentCommands
    .map((command) => elapsedSeconds(command.requested_at, command.claimed_at))
    .filter((value): value is number => value !== null);
  const averageClaimLatency = claimLatencies.length
    ? claimLatencies.reduce((sum, value) => sum + value, 0) / claimLatencies.length
    : null;
  const hasActiveCommands = activeCommands.length > 0;

  const queueView = (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="border-b border-white/8 pb-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <CardTitle as="h2" className="text-xl">Queue snapshot</CardTitle>
              <CardDescription className="mt-1">Capture a fresh observability snapshot from a supported target.</CardDescription>
            </div>
            <Badge variant="outline" className="w-fit font-mono text-[0.68rem] uppercase tracking-[0.14em] text-muted-foreground">snapshot · v1</Badge>
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          {isOperator ? (
            <form action={enqueueSnapshot} className="grid gap-6">
              <input type="hidden" name="commandKey" value={commandKey} />

              {params.queued ? (
                <div className="rounded-xl border border-primary/20 bg-primary/7 p-4 text-sm">
                  <div className="font-medium text-primary">Command accepted</div>
                  <div className="mt-1 break-all font-mono text-xs text-muted-foreground">{params.queued}</div>
                  <div className="mt-3 text-xs leading-5 text-muted-foreground">
                    {params.wake === "dispatched"
                      ? "Trusted worker dispatched immediately. Lifecycle status will update in History."
                      : params.wake === "unconfigured"
                        ? "Immediate worker wake is not configured; the durable queue remains authoritative."
                        : "Immediate worker wake failed; the durable queue remains authoritative."}
                  </div>
                </div>
              ) : null}

              {params.error === "enqueue" ? (
                <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
                  The snapshot command could not be queued. No execution was started.
                </div>
              ) : null}

              {params.error === "validation" ? (
                <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
                  Target, shard, and room must form a valid explicit snapshot scope. No command was queued.
                </div>
              ) : null}

              <div className="grid gap-5 md:grid-cols-3">
                <div className="grid gap-2">
                  <label htmlFor="target" className="text-sm font-medium">Target</label>
                  <select id="target" name="target" defaultValue="ptr" className="h-11 rounded-xl border border-white/10 bg-black/15 px-3 text-sm outline-none transition focus:border-primary/60">
                    <option value="ptr">PTR</option>
                    <option value="world">World</option>
                    <option value="sim">Sim</option>
                    <option value="headless">Headless</option>
                  </select>
                </div>
                <div className="grid gap-2">
                  <label htmlFor="shard" className="text-sm font-medium">Shard</label>
                  <Input id="shard" name="shard" defaultValue="shard3" required className="h-11 rounded-xl border-white/10 bg-black/15" />
                </div>
                <div className="grid gap-2">
                  <label htmlFor="roomName" className="text-sm font-medium">Room</label>
                  <Input id="roomName" name="roomName" defaultValue="W39S23" required className="h-11 rounded-xl border-white/10 bg-black/15 font-mono" />
                </div>
              </div>

              <div className="flex flex-col justify-between gap-4 border-t border-white/8 pt-5 sm:flex-row sm:items-center">
                <p className="max-w-xl text-xs leading-5 text-muted-foreground">Queueing never exposes the Screeps token. The trusted worker claims the command atomically and reports lifecycle state back to Supabase.</p>
                <Button type="submit" size="lg" className="shrink-0 rounded-xl px-6">Queue snapshot</Button>
              </div>
            </form>
          ) : (
            <div className="rounded-xl border border-white/8 bg-black/10 p-5">
              <div className="font-medium">Command submission disabled</div>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Authentication succeeded, but this identity is not present in the command operator allowlist.</p>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid content-start gap-4">
        <details className="group rounded-2xl border border-white/8 bg-card/65">
          <summary className="cursor-pointer list-none p-5 marker:hidden">
            <div className="flex items-center justify-between gap-4">
              <div><div className="text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">Authority</div><div className="mt-1 text-lg font-semibold">Session & security</div></div>
              <span className="text-muted-foreground transition group-open:rotate-45" aria-hidden="true">+</span>
            </div>
          </summary>
          <div className="border-t border-white/8 p-5 pt-4">
            <div className="rounded-xl border border-white/8 bg-black/15 p-4">
              <div className="text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">Supabase subject</div>
              <div className="mt-2 break-all font-mono text-xs leading-5 text-foreground/80">{claims.sub}</div>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-xl border border-white/8 p-3"><div className="text-xs text-muted-foreground">Authenticated</div><div className="mt-1 font-medium text-emerald-300">Yes</div></div>
              <div className="rounded-xl border border-white/8 p-3"><div className="text-xs text-muted-foreground">Command authority</div><div className={isOperator ? "mt-1 font-medium text-primary" : "mt-1 font-medium text-muted-foreground"}>{isOperator ? "Granted" : "Denied"}</div></div>
            </div>
            <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/8 pt-4">
              <div><div className="text-sm font-medium">End operator session</div><div className="mt-1 text-xs text-muted-foreground">Clears the Supabase browser session.</div></div>
              <form action="/auth/signout" method="post"><Button type="submit" variant="outline" className="rounded-xl">Sign out</Button></form>
            </div>
          </div>
        </details>

        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
          <CardHeader className="pb-3"><CardDescription className="text-[0.68rem] uppercase tracking-[0.18em]">Execution boundary</CardDescription><CardTitle as="h2" className="text-lg">What happens next</CardTitle></CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">The browser only requests. Supabase records authority. A trusted GitHub worker claims and executes. History is the audit trail.</CardContent>
        </Card>
      </div>
    </div>
  );

  const historyView = isOperator ? (
    <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
      <CardHeader className="border-b border-white/8 pb-5">
        <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
          <div><CardDescription className="text-[0.68rem] uppercase tracking-[0.18em]">Command ledger</CardDescription><CardTitle as="h2" className="mt-1 text-xl">Recent activity</CardTitle><CardDescription className="mt-1">Expand a command only when you need its lifecycle or execution metadata.</CardDescription></div>
          <Badge variant="outline" className="w-fit text-muted-foreground">{recentCommands.length} recent</Badge>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {recentCommands.length ? (
          <div className="divide-y divide-white/8">
            {recentCommands.map((command) => {
              const events = [...(command.command_events ?? [])].sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
              const claimLatency = elapsedSeconds(command.requested_at, command.claimed_at);
              const totalDuration = elapsedSeconds(command.requested_at, command.completed_at);
              const runId = workerRunId(command.claimed_by);

              return (
                <details key={command.id} className="group">
                  <summary className="cursor-pointer list-none p-5 marker:hidden hover:bg-white/[0.02]">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full border px-2.5 py-1 text-[0.68rem] font-medium uppercase tracking-[0.12em] ${statusClasses(command.status)}`}>{command.status}</span>
                          <span className="font-medium">{command.command_type}</span>
                          <span className="font-mono text-xs text-muted-foreground">{command.target} / {command.shard ?? "—"} / {command.room_name ?? "—"}</span>
                          {ACTIVE_STATUSES.has(command.status) ? <span aria-hidden="true" className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> : null}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground"><span>Queued {formatTimestamp(command.requested_at)}</span><span>Claim {formatDuration(claimLatency)}</span><span>Total {formatDuration(totalDuration)}</span></div>
                      </div>
                      <span className="text-muted-foreground transition group-open:rotate-45" aria-hidden="true">+</span>
                    </div>
                  </summary>
                  <div className="border-t border-white/7 bg-black/10 px-5 pb-5 pt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      {events.length ? events.map((event, index) => (
                        <div key={event.id} className="flex items-center gap-2">
                          {index ? <span className="h-px w-3 bg-white/15" /> : null}
                          <span className="rounded-md border border-white/8 bg-black/10 px-2 py-1 font-mono text-[0.65rem] text-foreground/70">{event.event_type}</span>
                        </div>
                      )) : <span className="text-xs text-muted-foreground">No lifecycle events recorded.</span>}
                    </div>
                    <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-[1fr_auto] sm:items-end">
                      <div><div className="text-[0.62rem] uppercase tracking-[0.16em]">Command key</div><div className="mt-1 break-all font-mono text-foreground/70">{command.command_key}</div></div>
                      {runId ? <a className="text-primary underline-offset-4 hover:underline" href={`https://github.com/jason-merrell/screeps-2026/actions/runs/${runId}`} target="_blank" rel="noreferrer">Open worker #{runId}</a> : null}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        ) : <div className="p-8 text-center text-sm text-muted-foreground">No native commands have been submitted from this operator identity yet.</div>}
      </CardContent>
    </Card>
  ) : (
    <Card className="lab-panel rounded-2xl border-white/8 bg-card/65"><CardContent className="p-6 text-sm text-muted-foreground">Command history is available only to authorized operators.</CardContent></Card>
  );

  return (
    <LabShell
      active="operator"
      eyebrow="trusted command surface"
      title="Operator console"
      description="Request narrow commands, then inspect lifecycle history only when you need the audit detail. Execution remains isolated in the trusted worker."
      status={
        <Badge variant={isOperator ? "default" : "outline"} className="w-fit px-3 py-1.5">
          <span className={isOperator ? "mr-2 h-1.5 w-1.5 rounded-full bg-black/60" : "mr-2 h-1.5 w-1.5 rounded-full bg-muted-foreground"} />
          {isOperator ? "Operator authorized" : "Read-only identity"}
        </Badge>
      }
    >
      <CommandHistoryRefresh active={hasActiveCommands} />

      <section aria-label="Command status at a glance" className="mb-6 grid grid-cols-3 gap-3 text-center text-xs">
        <div className="rounded-2xl border border-white/8 bg-card/65 px-3 py-4"><div className="text-muted-foreground">Active</div><div className="mt-1 text-2xl font-semibold">{activeCommands.length}</div></div>
        <div className="rounded-2xl border border-white/8 bg-card/65 px-3 py-4"><div className="text-muted-foreground">Success</div><div className="mt-1 text-2xl font-semibold">{terminalCommands.length ? `${Math.round((succeededCommands.length / terminalCommands.length) * 100)}%` : "—"}</div></div>
        <div className="rounded-2xl border border-white/8 bg-card/65 px-3 py-4"><div className="text-muted-foreground">Avg claim</div><div className="mt-1 text-2xl font-semibold">{formatDuration(averageClaimLatency)}</div></div>
      </section>

      <Tabs
        ariaLabel="Operator views"
        activeTab={activeView}
        tabs={[
          { id: "queue", label: "Queue", hint: "request work", href: tabHref("queue"), content: queueView },
          { id: "history", label: "History", hint: "audit lifecycle", href: tabHref("history"), content: historyView },
        ]}
      />
    </LabShell>
  );
}
