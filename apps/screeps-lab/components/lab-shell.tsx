import type { ReactNode } from "react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type LabShellProps = {
  children: ReactNode;
  active: "observability" | "operator";
  eyebrow?: string;
  title: string;
  description?: string;
  status?: ReactNode;
};

export function LabShell({ children, active, eyebrow = "Screeps control plane", title, description, status }: LabShellProps) {
  return (
    <div className="min-h-screen">
      <a
        href="#main-content"
        className="sr-only fixed left-4 top-3 z-50 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-lg focus:not-sr-only"
      >
        Skip to content
      </a>
      <header className="lab-topbar sticky top-0 z-40 border-b border-white/8 bg-background/82 backdrop-blur-xl">
        <div className="mx-auto flex w-[min(1480px,calc(100vw-32px))] items-center justify-between gap-2 py-2 min-[430px]:gap-4">
          <a href="/" className="group flex shrink-0 items-center gap-3" aria-label="Screeps Lab home">
            <span className="lab-mark" aria-hidden="true">
              <span />
              <span />
              <span />
            </span>
            <span className="hidden min-[430px]:block">
              <span className="block text-sm font-semibold tracking-tight text-foreground">Screeps Lab</span>
              <span className="block text-[0.68rem] uppercase tracking-[0.18em] text-muted-foreground">control plane</span>
            </span>
          </a>

          <nav className="flex min-w-0 items-center gap-1 rounded-xl border border-white/8 bg-black/15 p-1" aria-label="Primary navigation">
            <a
              href="/"
              className={cn(
                buttonVariants({ variant: active === "observability" ? "default" : "ghost", size: "sm" }),
                "rounded-lg px-3",
              )}
              aria-current={active === "observability" ? "page" : undefined}
            >
              Observability
            </a>
            <a
              href="/operator"
              className={cn(
                buttonVariants({ variant: active === "operator" ? "default" : "ghost", size: "sm" }),
                "rounded-lg px-3",
              )}
              aria-current={active === "operator" ? "page" : undefined}
            >
              Operator
            </a>
          </nav>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="mx-auto w-[min(1480px,calc(100vw-32px))] pb-16 pt-8 outline-none md:pt-10">
        <section className="mb-8 flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-3 text-[0.7rem] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              <span className="h-px w-8 bg-primary/70" />
              {eyebrow}
            </div>
            <h1 className="text-balance text-4xl font-semibold tracking-[-0.045em] text-foreground md:text-6xl">{title}</h1>
            {description ? <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground md:text-base">{description}</p> : null}
          </div>
          {status ?? <Badge variant="outline" className="w-fit px-3 py-1.5 text-muted-foreground">Live control surface</Badge>}
        </section>

        {children}
      </main>
    </div>
  );
}
