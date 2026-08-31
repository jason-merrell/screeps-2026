import type { Intent } from "../intents/types";
import type { FspmDomain, FspmTaskKpiRubric } from "./fspm";

export type FspmComposition = "atomic" | "compound";
export type FspmOutputIndependence = "independent" | "contributory";

export const FSPM_GOVERNANCE_SHA = "02d581886a759d19044ff91a80d743fa042f23f7";

export interface FspmTaskDetermination {
  output: string;
  composition: FspmComposition;
  outputIndependence: FspmOutputIndependence;
  independentlyMeasurable: true;
  rationale: string;
  governanceSha: string;
}

export interface FspmProcedureDefinition {
  key: string;
  title: string;
  /** Intent operations this Procedure is permitted to authorize. */
  allowedIntentTypes: readonly Intent["type"][];
}

export interface FspmTaskDefinition {
  domain: FspmDomain;
  taskKey: string;
  title: string;
  description: string;
  taskWeight: number;
  qualityDescription: string;
  qualityMetric: string;
  kpiMetric: FspmTaskKpiRubric;
  procedures: readonly FspmProcedureDefinition[];
  determination: FspmTaskDetermination;
}

const determination = (
  output: string,
  composition: FspmComposition,
  rationale: string,
): FspmTaskDetermination => ({
  output,
  composition,
  outputIndependence: "independent",
  independentlyMeasurable: true,
  rationale,
  governanceSha: FSPM_GOVERNANCE_SHA,
});

export const FSPM_TASK_CATALOG = [
  {
    domain: "economy",
    taskKey: "maintain-colony-energy-service",
    title: "Maintain Colony Energy Service",
    description:
      "Continuously extract, buffer, recover, transport, and deliver usable energy so colony operations remain supplied without avoidable logistics interruption.",
    taskWeight: 65,
    qualityDescription:
      "The colony has a continuous usable energy service from owned sources and recoverable stores to operational consumers, with source edges kept productive and transport capacity used without avoidable contention.",
    qualityMetric:
      "Each completed energy-service Activity must contain productive energy work, complete its governed collection-to-delivery or producer-to-buffer cycle without a non-transit execution error, and avoid unjustified target changes within a Procedure. Same-Procedure progression to another concrete target is allowed only when the previous target is already satisfied, such as a depleted source/store or a funded consumer. Exceptional performance additionally converts at least 75% of productive/travel/blocked/arbitration/assignment-gap execution ticks into productive work across a multi-step cycle.",
    kpiMetric: {
      metric: "Energy service cycle continuity and useful-work conversion",
      exceptional:
        "Completed cycle has productive work, zero blocked ticks, zero unsatisfied-target retargets, at least one governed Procedure transition, and work-conversion ratio >= 0.75",
      satisfactory:
        "Completed cycle has productive work, zero blocked ticks, and no retarget away from an unsatisfied target; satisfied-target progression is permitted",
      unsatisfactory:
        "Cycle completes without productive work, experiences blocked execution, or abandons an unsatisfied target within a Procedure",
    },
    procedures: [
      {
        key: "extract-source-energy",
        title: "Extract Source Energy",
        allowedIntentTypes: ["harvest"],
      },
      {
        key: "buffer-source-energy",
        title: "Buffer Source Energy",
        allowedIntentTypes: ["transfer"],
      },
      {
        key: "withdraw-buffered-energy",
        title: "Withdraw Buffered Energy",
        allowedIntentTypes: ["withdraw"],
      },
      {
        key: "recover-salvage-energy",
        title: "Recover Salvage Energy",
        allowedIntentTypes: ["withdraw"],
      },
      {
        key: "stage-source-transport",
        title: "Stage Source Transport",
        allowedIntentTypes: ["move"],
      },
      {
        key: "park-surplus-transport",
        title: "Park Surplus Transport",
        allowedIntentTypes: ["move"],
      },
      {
        key: "fund-workforce-energy",
        title: "Fund Workforce Energy",
        allowedIntentTypes: ["transfer"],
      },
    ],
    determination: determination(
      "a logged recurring colony energy-service cycle that leaves usable energy at an operational buffer or consumer",
      "compound",
      "The service is composed of substantive extraction, buffering, collection, positioning, and delivery steps; its output is independently measurable as successful energy-service cycles rather than any individual game command.",
    ),
  },
  {
    domain: "economy",
    taskKey: "advance-controller-capability",
    title: "Advance Controller Capability",
    description:
      "Invest available service energy into the owned room controller to advance or sustain room-control capability.",
    taskWeight: 35,
    qualityDescription:
      "Surplus colony energy is converted into owned-controller progress without avoidable execution failure or excessive travel overhead.",
    qualityMetric:
      "A completed controller Activity must contain at least one successful upgrade action and zero blocked execution ticks. Exceptional performance achieves work-conversion ratio >= 0.60 over the Activity.",
    kpiMetric: {
      metric: "Controller advancement execution quality",
      exceptional:
        "Completed Activity records productive controller work, zero blocked ticks, and work-conversion ratio >= 0.60",
      satisfactory:
        "Completed Activity records productive controller work with zero blocked ticks",
      unsatisfactory:
        "Activity completes without productive controller work or with blocked execution",
    },
    procedures: [
      {
        key: "upgrade-controller",
        title: "Upgrade Controller",
        allowedIntentTypes: ["upgrade"],
      },
    ],
    determination: determination(
      "externally evidenced owned-controller progress and room-control capability",
      "atomic",
      "Although the immediate game operation is singular, controller progress is a discrete persistent output with its own independently scored quality metric, satisfying the governed atomic-independent exception.",
    ),
  },
  {
    domain: "spawning",
    taskKey: "maintain-workforce-capacity",
    title: "Maintain Workforce Capacity",
    description:
      "Continuously maintain enough viable creep capability to satisfy bootstrap, source-production, logistics-throughput, and general colony demand.",
    taskWeight: 100,
    qualityDescription:
      "The colony maintains viable workforce capacity before incumbents expire, with source-production and transport capability meeting the room plan's measured demand and emergency recovery available when workforce reaches zero.",
    qualityMetric:
      "Each staffing Activity is a per-occurrence execution instance created from a measured workforce, producer, transport, or emergency-recovery deficit. It completes only when the specific creep requested by that staffing Procedure reaches a viable non-spawning state; additional remaining deficits generate additional Activities rather than being attributed to the completed instance. Aggregate workforce coverage remains a service-level signal and is not fabricated as the KPI result of one staffing occurrence.",
    kpiMetric: {
      metric: "Viable workforce increment delivered by staffing Activity",
      exceptional:
        "The requested viable workforce increment is delivered without blocked execution and there is independent evidence that it also closes the measured service deficit or preserves replacement lead time",
      satisfactory:
        "The requested staffing increment reaches a viable non-spawning state with productive spawn execution and no blocked execution",
      unsatisfactory:
        "The staffing occurrence concludes without producing its requested viable workforce increment or requires material rework",
    },
    procedures: [
      {
        key: "recover-emergency-workforce",
        title: "Recover Emergency Workforce",
        allowedIntentTypes: ["spawn"],
      },
      {
        key: "staff-source-production",
        title: "Staff Source Production",
        allowedIntentTypes: ["spawn"],
      },
      {
        key: "staff-transport-capacity",
        title: "Staff Transport Capacity",
        allowedIntentTypes: ["spawn"],
      },
      {
        key: "maintain-general-workforce",
        title: "Maintain General Workforce",
        allowedIntentTypes: ["spawn"],
      },
    ],
    determination: determination(
      "a recurring workforce-capacity service with measured viable headcount and capability coverage",
      "compound",
      "Emergency recovery, producer staffing, transport staffing, and routine replacement are procedures serving one independently measured recurring workforce service. Each Activity is one triggered staffing occurrence; the Task-level service may require multiple Activity instances to close a larger deficit.",
    ),
  },
  {
    domain: "construction",
    taskKey: "realize-planned-infrastructure",
    title: "Realize Planned Infrastructure",
    description:
      "Translate the active room plan and observed traffic demand into correctly sited and completed colony infrastructure.",
    taskWeight: 70,
    qualityDescription:
      "Eligible room-plan structures and strategic/adaptive roads are realized at valid planned positions in governed priority order without exceeding controller or construction-site limits.",
    qualityMetric:
      "Each completed construction Activity must produce progress toward or completion of the selected planned infrastructure target without blocked execution; siting Procedures must create only valid, eligible sites and construction execution must terminate when the target becomes a built structure.",
    kpiMetric: {
      metric: "Planned infrastructure realization quality",
      exceptional:
        "Selected infrastructure is realized with zero blocked execution and work-conversion ratio >= 0.60",
      satisfactory:
        "Selected infrastructure is realized with productive work and zero blocked execution",
      unsatisfactory:
        "Selected infrastructure fails governed siting/build criteria or requires material rework",
    },
    procedures: [
      {
        key: "site-planned-structure",
        title: "Site Planned Structure",
        allowedIntentTypes: ["createConstructionSite"],
      },
      {
        key: "site-planned-road",
        title: "Site Planned Road",
        allowedIntentTypes: ["createConstructionSite"],
      },
      {
        key: "site-adaptive-road",
        title: "Site Adaptive Road",
        allowedIntentTypes: ["createConstructionSite"],
      },
      {
        key: "build-planned-infrastructure",
        title: "Build Planned Infrastructure",
        allowedIntentTypes: ["build"],
      },
    ],
    determination: determination(
      "persistent built infrastructure conforming to the active room plan or measured traffic demand",
      "compound",
      "Siting and build execution are contributory procedures; the retained structure/road is the independently measurable Task output.",
    ),
  },
  {
    domain: "construction",
    taskKey: "maintain-infrastructure-condition",
    title: "Maintain Infrastructure Condition",
    description:
      "Restore governed colony structures that fall below their operational health threshold.",
    taskWeight: 30,
    qualityDescription:
      "Operational colony infrastructure remains at or above governed health thresholds, including bounded rampart reserve and at least 50% health for maintained bootstrap structures.",
    qualityMetric:
      "A maintenance Activity completes only when its selected structure reaches the governed health threshold or the target is no longer present; satisfactory work contains productive repair execution with zero blocked ticks.",
    kpiMetric: {
      metric: "Infrastructure health restoration quality",
      exceptional:
        "Target reaches the governed health threshold with productive repair work, zero blocked ticks, and work-conversion ratio >= 0.60",
      satisfactory:
        "Target reaches the governed health threshold with productive repair work and zero blocked execution",
      unsatisfactory:
        "Target is not restored to the governed threshold or execution is materially blocked",
    },
    procedures: [
      {
        key: "repair-infrastructure",
        title: "Repair Infrastructure",
        allowedIntentTypes: ["repair"],
      },
    ],
    determination: determination(
      "a structure restored to a persistent governed health state",
      "atomic",
      "Repair commands are repeated atomic operations, but the retained independently measured output is the structure crossing its governed health gate.",
    ),
  },
  {
    domain: "defense",
    taskKey: "maintain-defensive-readiness",
    title: "Maintain Defensive Readiness",
    description:
      "Maintain tower energy readiness and repel hostile creeps when a room threat is present.",
    taskWeight: 100,
    qualityDescription:
      "Owned rooms preserve a bounded peacetime tower reserve and prioritize defensive energy/full tower action during active hostile presence so threats can be engaged immediately.",
    qualityMetric:
      "Tower reserve reaches the governed target when funding is required, and active hostiles are engaged by available towers without avoidable delay. A creep-funded readiness Activity must deliver useful tower energy with zero blocked execution.",
    kpiMetric: {
      metric: "Defensive readiness and threat-response quality",
      exceptional:
        "Readiness target is restored or hostile response begins immediately with no blocked governed execution",
      satisfactory:
        "Readiness or hostile-response requirement is satisfied within the current governed Activity",
      unsatisfactory:
        "Available defensive capability fails to satisfy the readiness or threat-response requirement",
    },
    procedures: [
      {
        key: "fund-tower-reserve",
        title: "Fund Tower Reserve",
        allowedIntentTypes: ["transfer"],
      },
      {
        key: "repel-hostile",
        title: "Repel Hostile",
        allowedIntentTypes: ["towerAttack"],
      },
    ],
    determination: determination(
      "a recurring defensive-readiness service with persistent tower reserve and logged hostile-response outcomes",
      "compound",
      "Tower funding and hostile attack are contributory procedures whose combined independently measured service output is room defensive readiness and threat response.",
    ),
  },
] as const satisfies readonly FspmTaskDefinition[];

// The execution authorizer reads these definitions directly. Deep-freeze the
// complete graph before building lookup indexes so a same-tick mutation cannot
// expand Procedure capability without changing governed source code.
for (const task of FSPM_TASK_CATALOG) {
  Object.freeze(task.kpiMetric);
  Object.freeze(task.determination);
  for (const procedure of task.procedures) {
    Object.freeze(procedure.allowedIntentTypes);
    Object.freeze(procedure);
  }
  Object.freeze(task.procedures);
  Object.freeze(task);
}
Object.freeze(FSPM_TASK_CATALOG);

const definitionById = new Map<string, FspmTaskDefinition>(
  FSPM_TASK_CATALOG.map((definition) => [
    `${definition.domain}:${definition.taskKey}`,
    definition as FspmTaskDefinition,
  ]),
);
const procedureDefinitionById = new Map<string, FspmProcedureDefinition>(
  FSPM_TASK_CATALOG.flatMap((definition) =>
    definition.procedures.map(
      (procedure) =>
        [
          `${definition.domain}:${definition.taskKey}:${procedure.key}`,
          procedure,
        ] as const,
    ),
  ),
);
const procedureIndexById = new Map<string, number>(
  FSPM_TASK_CATALOG.flatMap((definition) =>
    definition.procedures.map(
      (procedure, index) =>
        [
          `${definition.domain}:${definition.taskKey}:${procedure.key}`,
          index,
        ] as const,
    ),
  ),
);

export function fspmTaskDefinition(
  domain: FspmDomain,
  taskKey: string,
): FspmTaskDefinition | undefined {
  return definitionById.get(`${domain}:${taskKey}`);
}

export function fspmProcedureDefinition(
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): FspmProcedureDefinition | undefined {
  return procedureDefinitionById.get(`${domain}:${taskKey}:${procedureKey}`);
}

export function fspmProcedureIndex(
  domain: FspmDomain,
  taskKey: string,
  procedureKey: string,
): number | undefined {
  return procedureIndexById.get(`${domain}:${taskKey}:${procedureKey}`);
}

export function requireFspmTaskDefinition(
  domain: FspmDomain,
  taskKey: string,
): FspmTaskDefinition {
  const definition = fspmTaskDefinition(domain, taskKey);
  if (!definition) {
    throw new Error(
      `Unknown FSPM Task ${domain}:${taskKey}; candidate work must pass the governed Task-or-Procedure determination before runtime use`,
    );
  }
  return definition;
}

export function validateFspmTaskCatalog(): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const weightByDomain = new Map<FspmDomain, number>();

  for (const task of FSPM_TASK_CATALOG) {
    const id = `${task.domain}:${task.taskKey}`;
    if (seen.has(id)) errors.push(`duplicate Task definition ${id}`);
    seen.add(id);

    if (!task.title.trim()) errors.push(`${id} has no title`);
    if (!task.description.trim()) errors.push(`${id} has no description`);
    if (!task.qualityDescription.trim())
      errors.push(`${id} has no Quality Description`);
    if (!task.qualityMetric.trim())
      errors.push(`${id} has no operational Quality Metric`);
    if (task.taskWeight <= 0 || task.taskWeight > 100) {
      errors.push(`${id} has invalid Task Weight ${task.taskWeight}`);
    }
    const procedures: readonly FspmProcedureDefinition[] = task.procedures;
    if (procedures.length === 0) errors.push(`${id} has no Procedures`);
    if (!task.determination.independentlyMeasurable) {
      errors.push(`${id} failed independent measurability`);
    }
    if (task.determination.outputIndependence !== "independent") {
      errors.push(`${id} does not have an independent Task output`);
    }
    if (task.determination.governanceSha !== FSPM_GOVERNANCE_SHA) {
      errors.push(`${id} determination governance SHA is stale`);
    }
    const procedureKeys = new Set<string>();
    for (const procedure of procedures) {
      if (!procedure.key.trim())
        errors.push(`${id} contains a blank Procedure key`);
      if (procedureKeys.has(procedure.key)) {
        errors.push(`${id} contains duplicate Procedure ${procedure.key}`);
      }
      procedureKeys.add(procedure.key);
      if (procedure.allowedIntentTypes.length === 0) {
        errors.push(`${id}:${procedure.key} authorizes no intent operation`);
      }
      if (
        new Set(procedure.allowedIntentTypes).size !==
        procedure.allowedIntentTypes.length
      ) {
        errors.push(
          `${id}:${procedure.key} contains duplicate allowed intent operations`,
        );
      }
    }

    weightByDomain.set(
      task.domain,
      (weightByDomain.get(task.domain) ?? 0) + task.taskWeight,
    );
  }

  for (const domain of [
    "economy",
    "spawning",
    "construction",
    "defense",
  ] as const) {
    const weight = weightByDomain.get(domain) ?? 0;
    if (weight !== 100)
      errors.push(`${domain} Task Weights sum to ${weight}, expected 100`);
  }

  return errors;
}
