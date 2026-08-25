import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { sendMagicLink } from "./actions";

export const dynamic = "force-dynamic";

const errorMessage = (error?: string) => {
  if (error === "rate-limit") return "Too many sign-in requests. Email delivery is temporarily rate-limited. Try again shortly.";
  if (error === "invalid-email") return "Enter a valid email address.";
  if (error === "callback") return "That sign-in link could not be completed. Request a fresh link and try again.";
  if (error) return "Sign-in could not be started. Check the address and try again.";
  return null;
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const params = await searchParams;
  const message = errorMessage(params.error);
  const sent = params.sent === "1";

  return (
    <main className="login-grid relative min-h-screen overflow-hidden">
      <div className="login-orbit -left-24 top-20 h-72 w-72" aria-hidden="true" />
      <div className="login-orbit -right-36 bottom-[-80px] h-[420px] w-[420px]" aria-hidden="true" />

      <div className="mx-auto grid min-h-screen w-[min(1180px,calc(100vw-32px))] items-center gap-10 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:gap-20">
        <section className="relative z-10 py-8 lg:py-16">
          <a href="/" className="mb-16 inline-flex items-center gap-3" aria-label="Screeps Lab home">
            <span className="lab-mark" aria-hidden="true"><span /><span /><span /></span>
            <span>
              <span className="block text-sm font-semibold">Screeps Lab</span>
              <span className="block text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">control plane</span>
            </span>
          </a>

          <div className="max-w-2xl">
            <div className="mb-4 flex items-center gap-3 text-[0.7rem] font-medium uppercase tracking-[0.22em] text-muted-foreground">
              <span className="h-px w-8 bg-primary/70" />
              authenticated operator surface
            </div>
            <h1 className="text-balance text-5xl font-semibold tracking-[-0.055em] sm:text-6xl lg:text-7xl">
              Observe the colony.<br />Command with intent.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-muted-foreground">
              Screeps Lab is the remote control plane for runtime telemetry, experiments, room planning, and trusted operator commands.
            </p>
          </div>

          <div className="mt-10 grid max-w-xl grid-cols-3 gap-3 text-sm">
            {[
              ["01", "Observe", "Live sanitized telemetry"],
              ["02", "Queue", "Authenticated commands"],
              ["03", "Verify", "Auditable execution"],
            ].map(([index, label, detail]) => (
              <div key={index} className="border-l border-white/10 pl-3">
                <div className="lab-kicker font-mono text-xs">{index}</div>
                <div className="mt-1 font-medium">{label}</div>
                <div className="mt-1 hidden text-xs leading-5 text-muted-foreground sm:block">{detail}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="relative z-10 lg:justify-self-end">
          <Card className="lab-panel w-full max-w-md rounded-3xl border-white/8 bg-card/80 p-2 backdrop-blur-xl lg:min-w-[430px]">
            <CardContent className="p-6 sm:p-8">
              <div className="mb-8">
                <div className="mb-2 text-xs font-medium uppercase tracking-[0.18em] text-primary">Secure access</div>
                <h2 className="text-2xl font-semibold tracking-tight">Operator sign in</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  We’ll send a one-time sign-in link. Authentication proves identity; command authority is granted separately.
                </p>
              </div>

              {sent ? (
                <div className="grid gap-6">
                  <div className="rounded-2xl border border-primary/20 bg-primary/7 p-5">
                    <div className="mb-2 flex items-center gap-2 text-sm font-medium text-primary">
                      <span className="inline-block h-2 w-2 rounded-full bg-primary shadow-[0_0_16px_currentColor]" />
                      Magic link sent
                    </div>
                    <p className="text-sm leading-6 text-muted-foreground">
                      Open the newest email from this browser. The link is single-use and will return you directly to the operator console.
                    </p>
                  </div>
                  <a href="/login" className={cn(buttonVariants({ variant: "outline" }), "w-full rounded-xl")}>Use another email</a>
                </div>
              ) : (
                <form action={sendMagicLink} className="grid gap-5">
                  <div className="grid gap-2">
                    <label htmlFor="email" className="text-sm font-medium">Email address</label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      autoComplete="email"
                      autoFocus
                      placeholder="operator@example.com"
                      required
                      className="h-12 rounded-xl border-white/10 bg-black/15 px-4"
                    />
                  </div>
                  {message ? (
                    <div role="alert" className="rounded-xl border border-red-400/20 bg-red-400/5 px-4 py-3 text-sm leading-5 text-red-300">
                      {message}
                    </div>
                  ) : null}
                  <Button type="submit" size="lg" className="h-12 rounded-xl font-semibold">Send secure sign-in link</Button>
                </form>
              )}

              <div className="mt-8 border-t border-white/8 pt-5 text-xs leading-5 text-muted-foreground">
                Browser sessions use Supabase Auth. Execution credentials never enter the client.
              </div>
            </CardContent>
          </Card>
        </section>
      </div>
    </main>
  );
}
