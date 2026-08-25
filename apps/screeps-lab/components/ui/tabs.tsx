"use client";

import { type KeyboardEvent, type ReactNode, useId, useRef, useState } from "react";

import { cn } from "@/lib/utils";

type DashboardTab = {
  id: string;
  label: string;
  hint?: string;
  content: ReactNode;
};

type TabsProps = {
  tabs: DashboardTab[];
  defaultTab?: string;
  ariaLabel?: string;
};

export function Tabs({ tabs, defaultTab, ariaLabel = "Dashboard sections" }: TabsProps) {
  const instanceId = useId();
  const initial = defaultTab && tabs.some((tab) => tab.id === defaultTab) ? defaultTab : tabs[0]?.id;
  const [activeId, setActiveId] = useState(initial);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab.id === activeId));

  const activate = (index: number) => {
    const tab = tabs[index];
    if (!tab) return;
    setActiveId(tab.id);
    tabRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!tabs.length) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      activate((index + 1) % tabs.length);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      activate((index - 1 + tabs.length) % tabs.length);
    } else if (event.key === "Home") {
      event.preventDefault();
      activate(0);
    } else if (event.key === "End") {
      event.preventDefault();
      activate(tabs.length - 1);
    }
  };

  return (
    <div>
      <div className="sticky top-[69px] z-30 -mx-2 mb-5 overflow-x-auto px-2 py-2 backdrop-blur-xl" role="tablist" aria-label={ariaLabel}>
        <div className="inline-flex min-w-full gap-1 rounded-2xl border border-white/8 bg-background/88 p-1.5 shadow-lg shadow-black/10 sm:min-w-0">
          {tabs.map((tab, index) => {
            const selected = index === activeIndex;
            const tabId = `${instanceId}-${tab.id}-tab`;
            const panelId = `${instanceId}-${tab.id}-panel`;
            return (
              <button
                key={tab.id}
                ref={(node) => { tabRefs.current[index] = node; }}
                type="button"
                role="tab"
                id={tabId}
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                onClick={() => setActiveId(tab.id)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "min-w-[132px] flex-1 rounded-xl px-4 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70",
                  selected ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-white/[0.04] hover:text-foreground",
                )}
              >
                <span className="block text-sm font-semibold">{tab.label}</span>
                {tab.hint ? <span className={cn("mt-0.5 block text-[0.65rem]", selected ? "text-primary-foreground/70" : "text-muted-foreground/70")}>{tab.hint}</span> : null}
              </button>
            );
          })}
        </div>
      </div>

      {tabs.map((tab, index) => {
        const selected = index === activeIndex;
        return (
          <div
            key={tab.id}
            role="tabpanel"
            id={`${instanceId}-${tab.id}-panel`}
            aria-labelledby={`${instanceId}-${tab.id}-tab`}
            hidden={!selected}
          >
            {selected ? tab.content : null}
          </div>
        );
      })}
    </div>
  );
}
