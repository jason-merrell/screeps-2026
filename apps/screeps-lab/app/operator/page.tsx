import { redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OperatorPage() {
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

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl items-center px-4 py-12">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-2">
              <CardTitle>Operator access</CardTitle>
              <CardDescription>Supabase identity and command authority are evaluated independently.</CardDescription>
            </div>
            <Badge variant={isOperator ? "default" : "outline"}>
              {isOperator ? "Operator" : "Not authorized"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="rounded-lg border bg-background/30 p-4 text-sm">
            <div className="text-muted-foreground">Authenticated identity</div>
            <div className="mt-1 break-all font-mono text-xs">{claims.sub}</div>
          </div>

          {isOperator ? (
            <p className="text-sm text-muted-foreground">
              This identity is allowlisted for command submission. Execution authority remains server-side and is not exposed to the browser.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Authentication succeeded, but this identity is not present in the command operator allowlist. No command submission authority has been granted.
            </p>
          )}

          <div className="flex flex-wrap gap-3">
            <a href="/" className={cn(buttonVariants({ variant: "outline" }))}>Observability</a>
            <form action="/auth/signout" method="post">
              <Button type="submit" variant="ghost">Sign out</Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
