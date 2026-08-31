import type { CpuMode, TickBudget } from "./context";

export type RuntimePhaseName =
  | "fspm_governance"
  | "settlement"
  | "defense"
  | "spawning"
  | "construction"
  | "economy"
  | "fspm_maintenance"
  | "fspm_authority"
  | "activity_evidence"
  | "arbitration"
  | "execution";

export type RuntimePhaseClass = "survival" | "mandatory" | "deferrable";
export type RuntimePhaseStatus = "completed" | "skipped" | "failed";
export type RuntimePhaseSkipReason = "cadence" | "admission";
export type RuntimePhaseBudgetStatus =
  | "within_budget"
  | "soft_budget_exceeded"
  | "hard_budget_exceeded";

interface RuntimePhaseDefinition {
  class: RuntimePhaseClass;
  cadence: Record<CpuMode, number>;
  cadenceOffset: number;
  softBudgetRatio: number;
  hardBudgetRatio: number;
}

const everyTick: Record<CpuMode, number> = {
  critical: 1,
  constrained: 1,
  normal: 1,
  surplus: 1,
};

export const RUNTIME_PHASE_DEFINITIONS = {
  fspm_governance: {
    class: "mandatory",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.04,
    hardBudgetRatio: 0.1,
  },
  settlement: {
    class: "deferrable",
    cadence: { critical: 25, constrained: 5, normal: 1, surplus: 1 },
    cadenceOffset: 1,
    softBudgetRatio: 0.12,
    hardBudgetRatio: 0.24,
  },
  defense: {
    class: "survival",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.1,
    hardBudgetRatio: 0.2,
  },
  spawning: {
    class: "survival",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.1,
    hardBudgetRatio: 0.2,
  },
  construction: {
    class: "deferrable",
    cadence: { critical: 50, constrained: 5, normal: 1, surplus: 1 },
    cadenceOffset: 3,
    softBudgetRatio: 0.12,
    hardBudgetRatio: 0.25,
  },
  economy: {
    class: "survival",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.2,
    hardBudgetRatio: 0.35,
  },
  fspm_maintenance: {
    class: "mandatory",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.08,
    hardBudgetRatio: 0.16,
  },
  fspm_authority: {
    class: "mandatory",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.08,
    hardBudgetRatio: 0.16,
  },
  activity_evidence: {
    class: "mandatory",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.08,
    hardBudgetRatio: 0.16,
  },
  arbitration: {
    class: "mandatory",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.06,
    hardBudgetRatio: 0.12,
  },
  execution: {
    class: "mandatory",
    cadence: everyTick,
    cadenceOffset: 0,
    softBudgetRatio: 0.12,
    hardBudgetRatio: 0.25,
  },
} as const satisfies Record<RuntimePhaseName, RuntimePhaseDefinition>;

export interface RuntimePhaseStatsMemory {
  runs: number;
  failures: number;
  skips: number;
  lastRunTick?: number;
  lastCompletedTick?: number;
  lastFailureTick?: number;
  consecutiveFailures: number;
  lastStatus?: RuntimePhaseStatus;
  lastSkipReason?: RuntimePhaseSkipReason;
  cpuSamples: number[];
}

export interface RuntimeSupervisorMemory {
  version: 1;
  phases: Partial<Record<RuntimePhaseName, RuntimePhaseStatsMemory>>;
  lastPublication?: {
    tick: number;
    observability: number;
    total: number;
    segmentWritten: boolean;
  };
}

export interface RuntimePhaseTrace {
  name: RuntimePhaseName;
  class: RuntimePhaseClass;
  status: RuntimePhaseStatus;
  cadence: number;
  softBudget: number;
  hardBudget: number;
  admissionEstimate: number;
  admissionReserve: number;
  admissionProjected: number;
  cpu: number;
  budgetStatus: RuntimePhaseBudgetStatus;
  skipReason: RuntimePhaseSkipReason | null;
  error: string | null;
}

export interface RuntimePhasePercentiles {
  samples: number;
  p50: number | null;
  p95: number | null;
  p99: number | null;
}

export interface RuntimeSupervisorTrace {
  mode: CpuMode;
  deadline: number;
  headroom: number;
  scopeUnits: number;
  phases: RuntimePhaseTrace[];
  metrics: Record<RuntimePhaseName, RuntimePhasePercentiles>;
}

export interface RuntimeDeadline {
  deadline: number;
  headroom: number;
}

const CPU_SAMPLE_LIMIT = 128;
const OBSERVABILITY_PUBLICATION_RESERVE_RATIO = 0.05;
const ADMISSION_RESERVED_PHASES: RuntimePhaseName[] = [
  "fspm_governance",
  "defense",
  "spawning",
  "economy",
  "fspm_maintenance",
  "fspm_authority",
  "arbitration",
  "execution",
  "activity_evidence",
];

const roundCpu = (value: number): number => Math.round(value * 1000) / 1000;

export function createRuntimeSupervisorMemory(): RuntimeSupervisorMemory {
  return { version: 1, phases: {} };
}

export function runtimeDeadline(
  budget: Pick<TickBudget, "limit" | "bucket" | "mode">,
): RuntimeDeadline {
  const minimumHeadroom = Math.min(1, budget.limit * 0.2);
  const headroomRatio = budget.mode === "critical" ? 0.2 : 0.1;
  const headroom = Math.max(minimumHeadroom, budget.limit * headroomRatio);
  const bucketBurst =
    budget.mode === "surplus"
      ? Math.min(budget.limit * 0.5, Math.max(0, budget.bucket - 9_000) / 1_000)
      : 0;
  const ceiling =
    budget.mode === "critical"
      ? budget.limit * 0.8
      : budget.mode === "constrained"
        ? budget.limit * 0.9
        : budget.limit + bucketBurst;

  return {
    deadline: roundCpu(Math.max(0, ceiling - headroom)),
    headroom: roundCpu(headroom),
  };
}

function percentile(samples: number[], quantile: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(sorted.length * quantile) - 1);
  return roundCpu(sorted[index] ?? 0);
}

export function phasePercentiles(samples: number[]): RuntimePhasePercentiles {
  return {
    samples: samples.length,
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    p99: percentile(samples, 0.99),
  };
}

function phaseStats(
  memory: RuntimeSupervisorMemory,
  name: RuntimePhaseName,
): RuntimePhaseStatsMemory {
  const existing = memory.phases[name];
  if (existing) return existing;
  const created: RuntimePhaseStatsMemory = {
    runs: 0,
    failures: 0,
    skips: 0,
    consecutiveFailures: 0,
    cpuSamples: [],
  };
  memory.phases[name] = created;
  return created;
}

function cadenceDue(
  tick: number,
  cadence: number,
  offset: number,
  lastRunTick: number | undefined,
): boolean {
  if (cadence <= 1) return true;
  if (lastRunTick !== undefined) return tick - lastRunTick >= cadence;
  return (tick + offset) % cadence === 0;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error)
    return `${error.name}: ${error.message}`.slice(0, 240);
  return String(error).slice(0, 240);
}

function budgetStatus(
  cpu: number,
  softBudget: number,
  hardBudget: number,
): RuntimePhaseBudgetStatus {
  if (cpu > hardBudget) return "hard_budget_exceeded";
  if (cpu > softBudget) return "soft_budget_exceeded";
  return "within_budget";
}

function phaseEstimate(
  stats: RuntimePhaseStatsMemory,
  softBudget: number,
  _hardBudget: number,
): number {
  const rollingP95 = phasePercentiles(stats.cpuSamples).p95;
  return roundCpu(Math.max(0.02, rollingP95 ?? softBudget));
}

export class RuntimeSupervisor {
  readonly #budget: TickBudget;
  readonly #deadline: RuntimeDeadline;
  readonly #getUsed: () => number;
  readonly #memory: RuntimeSupervisorMemory;
  readonly #scopeUnits: number;
  readonly #tick: number;
  readonly #traces: RuntimePhaseTrace[] = [];

  constructor(input: {
    tick: number;
    budget: TickBudget;
    memory: RuntimeSupervisorMemory;
    getUsed: () => number;
    scopeUnits?: number;
  }) {
    this.#tick = input.tick;
    this.#budget = input.budget;
    this.#memory = input.memory;
    this.#scopeUnits = Math.max(1, Math.floor(input.scopeUnits ?? 1));
    this.#getUsed = input.getUsed;
    this.#deadline = runtimeDeadline(input.budget);
  }

  run<T>(name: RuntimePhaseName, operation: () => T, fallback: () => T): T {
    const definition = RUNTIME_PHASE_DEFINITIONS[name];
    const stats = phaseStats(this.#memory, name);
    const cadence = definition.cadence[this.#budget.mode];
    const softBudget = roundCpu(
      this.#budget.limit * definition.softBudgetRatio,
    );
    const hardBudget = roundCpu(
      this.#budget.limit * definition.hardBudgetRatio,
    );
    const admissionEstimate = phaseEstimate(stats, softBudget, hardBudget);
    const admissionReserve =
      definition.class === "deferrable"
        ? roundCpu(
            ADMISSION_RESERVED_PHASES.filter(
              (phase) => !this.#traces.some((trace) => trace.name === phase),
            ).reduce((sum, phase) => {
              const reservedDefinition = RUNTIME_PHASE_DEFINITIONS[phase];
              const reservedSoft = roundCpu(
                this.#budget.limit * reservedDefinition.softBudgetRatio,
              );
              const reservedHard = roundCpu(
                this.#budget.limit * reservedDefinition.hardBudgetRatio,
              );
              return (
                sum +
                phaseEstimate(
                  phaseStats(this.#memory, phase),
                  reservedSoft,
                  reservedHard,
                )
              );
            }, this.#budget.limit * OBSERVABILITY_PUBLICATION_RESERVE_RATIO) +
              Math.min(
                this.#budget.limit * 0.15,
                Math.max(0, this.#scopeUnits - 1) * this.#budget.limit * 0.01,
              ),
          )
        : 0;
    const admissionProjected = roundCpu(
      this.#getUsed() + admissionEstimate + admissionReserve,
    );
    const skipReason =
      definition.class === "deferrable" &&
      !cadenceDue(
        this.#tick,
        cadence,
        definition.cadenceOffset,
        stats.lastRunTick,
      )
        ? "cadence"
        : definition.class === "deferrable" &&
            admissionProjected > this.#deadline.deadline
          ? "admission"
          : null;

    if (skipReason) {
      stats.skips += 1;
      stats.lastStatus = "skipped";
      stats.lastSkipReason = skipReason;
      this.#traces.push({
        name,
        class: definition.class,
        status: "skipped",
        cadence,
        softBudget,
        hardBudget,
        admissionEstimate,
        admissionReserve,
        admissionProjected,
        cpu: 0,
        budgetStatus: "within_budget",
        skipReason,
        error: null,
      });
      return fallback();
    }

    const start = this.#getUsed();
    try {
      const value = operation();
      const cpu = roundCpu(Math.max(0, this.#getUsed() - start));
      stats.runs += 1;
      stats.lastRunTick = this.#tick;
      stats.lastCompletedTick = this.#tick;
      stats.consecutiveFailures = 0;
      stats.lastStatus = "completed";
      delete stats.lastSkipReason;
      stats.cpuSamples.push(cpu);
      if (stats.cpuSamples.length > CPU_SAMPLE_LIMIT) {
        stats.cpuSamples.splice(0, stats.cpuSamples.length - CPU_SAMPLE_LIMIT);
      }
      this.#traces.push({
        name,
        class: definition.class,
        status: "completed",
        cadence,
        softBudget,
        hardBudget,
        admissionEstimate,
        admissionReserve,
        admissionProjected,
        cpu,
        budgetStatus: budgetStatus(cpu, softBudget, hardBudget),
        skipReason: null,
        error: null,
      });
      return value;
    } catch (error) {
      const cpu = roundCpu(Math.max(0, this.#getUsed() - start));
      const message = errorMessage(error);
      stats.runs += 1;
      stats.failures += 1;
      stats.lastRunTick = this.#tick;
      stats.lastFailureTick = this.#tick;
      stats.consecutiveFailures += 1;
      stats.lastStatus = "failed";
      delete stats.lastSkipReason;
      stats.cpuSamples.push(cpu);
      if (stats.cpuSamples.length > CPU_SAMPLE_LIMIT) {
        stats.cpuSamples.splice(0, stats.cpuSamples.length - CPU_SAMPLE_LIMIT);
      }
      this.#traces.push({
        name,
        class: definition.class,
        status: "failed",
        cadence,
        softBudget,
        hardBudget,
        admissionEstimate,
        admissionReserve,
        admissionProjected,
        cpu,
        budgetStatus: budgetStatus(cpu, softBudget, hardBudget),
        skipReason: null,
        error: message,
      });
      console.log(`[runtime:${name}] ${message}`);
      return fallback();
    }
  }

  orderDeferrable<T extends RuntimePhaseName>(names: readonly T[]): T[] {
    return [...names].sort((left, right) => {
      const score = (name: RuntimePhaseName): number => {
        const stats = this.#memory.phases[name];
        const cadence =
          RUNTIME_PHASE_DEFINITIONS[name].cadence[this.#budget.mode];
        const last = stats?.lastCompletedTick ?? stats?.lastRunTick;
        return last === undefined
          ? Number.POSITIVE_INFINITY
          : (this.#tick - last) / Math.max(1, cadence);
      };
      const leftScore = score(left);
      const rightScore = score(right);
      if (leftScore === Number.POSITIVE_INFINITY && rightScore !== leftScore)
        return -1;
      if (rightScore === Number.POSITIVE_INFINITY && leftScore !== rightScore)
        return 1;
      const debt = rightScore - leftScore;
      if (Number.isFinite(debt) && debt !== 0) return debt;
      const leftIndex = names.indexOf(left);
      const rightIndex = names.indexOf(right);
      return (
        ((leftIndex + this.#tick) % names.length) -
        ((rightIndex + this.#tick) % names.length)
      );
    });
  }

  trace(): RuntimeSupervisorTrace {
    return {
      mode: this.#budget.mode,
      deadline: this.#deadline.deadline,
      headroom: this.#deadline.headroom,
      scopeUnits: this.#scopeUnits,
      phases: this.#traces.map((trace) => ({ ...trace })),
      metrics: Object.fromEntries(
        (Object.keys(RUNTIME_PHASE_DEFINITIONS) as RuntimePhaseName[]).map(
          (name) => [
            name,
            phasePercentiles(this.#memory.phases[name]?.cpuSamples ?? []),
          ],
        ),
      ) as Record<RuntimePhaseName, RuntimePhasePercentiles>,
    };
  }
}
