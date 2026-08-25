import { randomUUID } from "node:crypto";

import { redirect } from "next/navigation";

import { enqueueSnapshot } from "@/app/operator/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { LabShell } from "@/components/lab-shell";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type OperatorPageProps = {
  searchParams: Promise<{ queued?: string; error?: string }>;
};

export default async function OperatorPage({ searchParams }: OperatorPageProps) {
  const params = await searchParams;
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

  return (
    <LabShell
      active="operator"
      eyebrow="trusted command surface"
      title="Operator console"
      description="Submit narrow, auditable commands into the Supabase authority queue. Browser identity is authenticated here; execution remains isolated in the trusted worker."
      status={
        <Badge variant={isOperator ? "default" : "outline"} className="w-fit px-3 py-1.5">
          <span className={isOperator ? "mr-2 h-1.5 w-1.5 rounded-full bg-black/60" : "mr-2 h-1.5 w-1.5 rounded-full bg-muted-foreground"} />
          {isOperator ? "Operator authorized" : "Read-only identity"}
        </Badge>
      }
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(300px,0.75fr)]">
        <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
          <CardHeader className="border-b border-white/8 pb-5">
            <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
              <div>
                <CardTitle className="text-xl">Queue snapshot</CardTitle>
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
                  </div>
                ) : null}

                {params.error === "enqueue" ? (
                  <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 p-4 text-sm text-red-300">
                    The snapshot command could not be queued. No execution was started.
                  </div>
                ) : null}

                <div className="grid gap-5 md:grid-cols-3">
                  <div className="grid gap-2">
                    <label htmlFor="target" className="text-sm font-medium">Target</label>
                    <select
                      id="target"
                      name="target"
                      defaultValue="ptr"
                      className="h-11 rounded-xl border border-white/10 bg-black/15 px-3 text-sm outline-none transition focus:border-primary/60"
                    >
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
                  <p className="max-w-xl text-xs leading-5 text-muted-foreground">
                    Queueing does not expose the Screeps token. A trusted GitHub worker claims this command atomically and reports its terminal state back to Supabase.
                  </p>
                  <Button type="submit" size="lg" className="shrink-0 rounded-xl px-6">Queue snapshot</Button>
                </div>
              </form>
            ) : (
              <div className="rounded-xl border border-white/8 bg-black/10 p-5">
                <div className="font-medium">Command submission disabled</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Authentication succeeded, but this identity is not present in the command operator allowlist.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-5">
          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardHeader className="pb-3">
              <CardDescription className="text-[0.68rem] uppercase tracking-[0.18em]">Authority</CardDescription>
              <CardTitle className="text-lg">Session identity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="rounded-xl border border-white/8 bg-black/15 p-4">
                <div className="text-[0.68rem] uppercase tracking-[0.16em] text-muted-foreground">Supabase subject</div>
                <div className="mt-2 break-all font-mono text-xs leading-5 text-foreground/80">{claims.sub}</div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-white/8 p-3">
                  <div className="text-xs text-muted-foreground">Authenticated</div>
                  <div className="mt-1 font-medium text-emerald-300">Yes</div>
                </div>
                <div className="rounded-xl border border-white/8 p-3">
                  <div className="text-xs text-muted-foreground">Command authority</div>
                  <div className={isOperator ? "mt-1 font-medium text-primary" : "mt-1 font-medium text-muted-foreground"}>{isOperator ? "Granted" : "Denied"}</div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="lab-panel rounded-2xl border-white/8 bg-card/65">
            <CardContent className="flex items-center justify-between gap-4 p-5">
              <div>
                <div className="text-sm font-medium">End operator session</div>
                <div className="mt-1 text-xs text-muted-foreground">Clears the Supabase browser session.</div>
              </div>
              <form action="/auth/signout" method="post">
                <Button type="submit" variant="outline" className="rounded-xl">Sign out</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </LabShell>
  );
}
