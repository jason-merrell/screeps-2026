import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type DashboardTab = {
  id: string;
  label: string;
  hint?: string;
  href: string;
  content: ReactNode;
};

type TabsProps = {
  tabs: DashboardTab[];
  activeTab: string;
  ariaLabel?: string;
};

export function Tabs({ tabs, activeTab, ariaLabel = "Dashboard sections" }: TabsProps) {
  const active = tabs.find((tab) => tab.id === activeTab) ?? tabs[0];
  if (!active) return null;

  return (
    <div>
      <div className="sticky top-[59px] z-30 -mx-2 mb-5 px-2 py-2 backdrop-blur-xl">
        <nav
          className="grid grid-cols-2 gap-1 rounded-2xl border border-white/8 bg-background/92 p-1.5 shadow-lg shadow-black/10 sm:flex"
          aria-label={ariaLabel}
        >
          {tabs.map((tab) => {
            const selected = tab.id === active.id;
            return (
              <a
                key={tab.id}
                id={`${tab.id}-view-link`}
                href={tab.href}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "min-w-0 flex-1 rounded-xl px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:min-w-[132px] sm:px-4",
                  selected ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <span className="block truncate text-sm font-semibold">{tab.label}</span>
                {tab.hint ? (
                  <span className={cn(
                    "mt-0.5 hidden truncate text-[0.65rem] min-[390px]:block",
                    selected ? "text-primary-foreground/70" : "text-muted-foreground/70",
                  )}>
                    {tab.hint}
                  </span>
                ) : null}
              </a>
            );
          })}
        </nav>
      </div>

      <section aria-labelledby={`${active.id}-view-link`}>
        {active.content}
      </section>
    </div>
  );
}
