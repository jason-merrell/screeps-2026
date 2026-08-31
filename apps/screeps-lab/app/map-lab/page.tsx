import Link from "next/link";
import { notFound } from "next/navigation";

import { StrategicRoomMap } from "@/components/strategic-room-map";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PlannedStructure, Snapshot } from "@/lib/control-plane";
import type { RoomDevelopmentSummary } from "@/lib/room-development";
import {
  runtimeRoomPlanFingerprint,
  snapshotRoomPlanDigest,
} from "@/lib/strategic-room-map";

export const dynamic = "force-dynamic";

const ROOM = "E52N38";

const encodedTerrain = () => {
  const cells = Array.from({ length: 2_500 }, () => "0");
  for (let y = 0; y < 50; y += 1) {
    for (let x = 0; x < 50; x += 1) {
      const border = x === 0 || x === 49 || y === 0 || y === 49;
      const exit =
        (y === 0 && x >= 22 && x <= 27) ||
        (y === 49 && x >= 10 && x <= 15) ||
        (x === 0 && y >= 18 && y <= 22) ||
        (x === 49 && y >= 30 && y <= 35);
      const wall =
        (border && !exit) ||
        (x >= 4 && x <= 9 && y >= 7 && y <= 12 && (x + y) % 3 !== 0) ||
        (x >= 38 && x <= 44 && y >= 31 && y <= 38 && (x + y) % 4 !== 0) ||
        (x >= 6 && x <= 12 && y >= 37 && y <= 41 && (x + y) % 3 === 0);
      const swamp =
        !wall &&
        ((x >= 31 && x <= 37 && y >= 7 && y <= 14) ||
          (x >= 9 && x <= 16 && y >= 28 && y <= 34));
      cells[y * 50 + x] = wall ? "1" : swamp ? "2" : "0";
    }
  }
  return cells.join("");
};

const perimeter = [
  ...Array.from({ length: 23 }, (_, index) => ({ x: 14 + index, y: 14 })),
  ...Array.from({ length: 23 }, (_, index) => ({ x: 14 + index, y: 36 })),
  ...Array.from({ length: 21 }, (_, index) => ({ x: 14, y: 15 + index })),
  ...Array.from({ length: 21 }, (_, index) => ({ x: 36, y: 15 + index })),
];

const roads = [
  ...Array.from({ length: 25 }, (_, index) => ({
    id: `road:east:${index}`,
    x: 12 + index,
    y: 25,
    minRcl: 3,
  })),
  ...Array.from({ length: 23 }, (_, index) => ({
    id: `road:south:${index}`,
    x: 25,
    y: 14 + index,
    minRcl: 3,
  })),
];

const structures: PlannedStructure[] = [
  {
    id: "spawn:24:24",
    structureType: "spawn",
    x: 24,
    y: 24,
    minRcl: 1,
    stage: "bootstrap",
  },
  {
    id: "spawn:26:24",
    structureType: "spawn",
    x: 26,
    y: 24,
    minRcl: 7,
    stage: "advanced-operations",
  },
  {
    id: "extension:23:23",
    structureType: "extension",
    x: 23,
    y: 23,
    minRcl: 2,
    stage: "logistics",
  },
  {
    id: "extension:25:23",
    structureType: "extension",
    x: 25,
    y: 23,
    minRcl: 2,
    stage: "logistics",
  },
  {
    id: "extension:27:23",
    structureType: "extension",
    x: 27,
    y: 23,
    minRcl: 3,
    stage: "logistics",
  },
  {
    id: "tower:22:24",
    structureType: "tower",
    x: 22,
    y: 24,
    minRcl: 3,
    stage: "logistics",
  },
  {
    id: "tower:28:24",
    structureType: "tower",
    x: 28,
    y: 24,
    minRcl: 5,
    stage: "core-economy",
  },
  {
    id: "storage:24:26",
    structureType: "storage",
    x: 24,
    y: 26,
    minRcl: 4,
    stage: "core-economy",
  },
  {
    id: "terminal:26:26",
    structureType: "terminal",
    x: 26,
    y: 26,
    minRcl: 6,
    stage: "advanced-operations",
  },
  {
    id: "factory:25:27",
    structureType: "factory",
    x: 25,
    y: 27,
    minRcl: 7,
    stage: "advanced-operations",
  },
  {
    id: "link:23:26",
    structureType: "link",
    x: 23,
    y: 26,
    minRcl: 5,
    stage: "core-economy",
  },
  {
    id: "link:34:10",
    structureType: "link",
    x: 34,
    y: 10,
    minRcl: 6,
    stage: "advanced-operations",
  },
  {
    id: "container:11:19",
    structureType: "container",
    x: 11,
    y: 19,
    minRcl: 2,
    stage: "logistics",
  },
  {
    id: "lab:28:28",
    structureType: "lab",
    x: 28,
    y: 28,
    minRcl: 6,
    stage: "advanced-operations",
  },
  {
    id: "lab:29:28",
    structureType: "lab",
    x: 29,
    y: 28,
    minRcl: 6,
    stage: "advanced-operations",
  },
  {
    id: "lab:28:29",
    structureType: "lab",
    x: 28,
    y: 29,
    minRcl: 6,
    stage: "advanced-operations",
  },
  {
    id: "observer:21:28",
    structureType: "observer",
    x: 21,
    y: 28,
    minRcl: 8,
    stage: "mature-rcl8",
  },
  {
    id: "powerSpawn:22:28",
    structureType: "powerSpawn",
    x: 22,
    y: 28,
    minRcl: 8,
    stage: "mature-rcl8",
  },
  {
    id: "nuker:23:28",
    structureType: "nuker",
    x: 23,
    y: 28,
    minRcl: 8,
    stage: "mature-rcl8",
  },
];

const planContent = {
  roomName: ROOM,
  version: 4,
  horizonRcl: 8,
  plannerRevision: 1,
  projectionRevision: 42,
  anchors: {
    spawn: { x: 24, y: 24, name: "Aegis-1" },
    hub: { x: 25, y: 25 },
    controller: { x: 34, y: 9, service: { x: 34, y: 10 } },
    sources: [
      { x: 10, y: 18, container: { x: 11, y: 19 } },
      { x: 40, y: 22, container: { x: 39, y: 23 } },
    ],
  },
  structures,
  roads,
  defense: {
    strategy: "terrain-mincut-v1" as const,
    protectedTiles: [{ x: 25, y: 25 }],
    perimeter,
  },
};

const projectionFingerprint = runtimeRoomPlanFingerprint(planContent) ?? "";
const plan = { ...planContent, projectionFingerprint };

const currentSnapshot = (): Snapshot => ({
  room: ROOM,
  shard: "shard3",
  target: "fixture",
  terrain: {
    encoding: "screeps-terrain-mask/v1",
    width: 50,
    height: 50,
    cells: encodedTerrain(),
  },
  captureConsistency: {
    status: "matched",
    initialTick: 912_440,
    finalTick: 912_440,
    reason:
      "Trace fence held at tick 912440 for one exact settlement projection epoch.",
  },
  roomPlan: plan,
  roomPlanIntegrity: {
    projectionScheme: "room-plan-fingerprint/v1",
    declaredFingerprint: projectionFingerprint,
    runtimeComputedFingerprint: projectionFingerprint,
    runtimeVerified: true,
    snapshotDigestScheme: "screeps-lab-room-plan-digest/v1",
    snapshotDigest: snapshotRoomPlanDigest(plan),
  },
  colony: {
    controller: { x: 34, y: 9, level: 8 },
    sources: [
      { x: 10, y: 18 },
      { x: 40, y: 22 },
    ],
    minerals: [{ x: 42, y: 41 }],
    structures: [
      { type: "spawn", x: 24, y: 24, owned: true, hits: 5_000, hitsMax: 5_000 },
      {
        type: "extension",
        x: 23,
        y: 23,
        owned: true,
        hits: 1_000,
        hitsMax: 1_000,
      },
      { type: "tower", x: 22, y: 24, owned: true, hits: 3_000, hitsMax: 3_000 },
      {
        type: "storage",
        x: 24,
        y: 26,
        owned: true,
        hits: 10_000,
        hitsMax: 10_000,
      },
      { type: "road", x: 25, y: 25, owned: null, hits: 3_100, hitsMax: 5_000 },
      {
        type: "container",
        x: 11,
        y: 19,
        owned: null,
        hits: 140_000,
        hitsMax: 250_000,
      },
      {
        type: "tower",
        x: 27,
        y: 27,
        owned: false,
        hits: 1_500,
        hitsMax: 3_000,
      },
      {
        type: "rampart",
        x: 14,
        y: 20,
        owned: true,
        hits: 350_000,
        hitsMax: 300_000_000,
      },
      {
        type: "rampart",
        x: 14,
        y: 21,
        owned: true,
        hits: 5_400_000,
        hitsMax: 300_000_000,
      },
    ],
    constructionSites: [
      {
        structureType: "extension",
        x: 25,
        y: 23,
        owned: true,
        progress: 1_250,
        progressTotal: 3_000,
      },
      {
        structureType: "lab",
        x: 28,
        y: 28,
        owned: true,
        progress: 8_000,
        progressTotal: 50_000,
      },
      {
        structureType: "terminal",
        x: 19,
        y: 19,
        owned: false,
        progress: 200,
        progressTotal: 100_000,
      },
    ],
  },
});

const development = (): RoomDevelopmentSummary =>
  ({
    state: "developing",
    health: "watch",
    missingStructureCount: 15,
    blockedStructureCount: 1,
    projection: {
      planId: "room:E52N38",
      deliverableId: "fspm:room-plan",
      plannerRevision: 1,
      projectionRevision: 42,
      projectionFingerprint,
      generatedAt: 912_400,
      traceAlignment: "matched",
      runtimeUsability: {
        usable: true,
        status: "current",
        reason: "Room-plan projection epoch is current and fingerprint-valid.",
      },
      fault: null,
      faultAlignment: null,
    },
    defense: {
      state: "strengthening",
      strategy: "terrain-mincut-v1",
      plannedCount: perimeter.length,
      builtCount: 2,
      atTargetCount: 1,
      conditionEvidenceCount: 2,
      coveragePercentage: 2.27,
      targetHits: 5_000_000,
      underAttack: false,
      nextMissingTile: { x: 14, y: 22 },
    },
    missingCriticalStructures: [
      {
        id: "extension:25:23",
        stageId: "logistics",
        structureType: "extension",
        x: 25,
        y: 23,
        minRcl: 2,
        priority: 95,
        strategicWeight: 8,
        controllerEligible: true,
        realized: false,
        underConstruction: true,
        blockers: [],
      },
      {
        id: "link:34:10",
        stageId: "advanced-operations",
        structureType: "link",
        x: 34,
        y: 10,
        minRcl: 6,
        priority: 80,
        strategicWeight: 6,
        controllerEligible: true,
        realized: false,
        underConstruction: false,
        blockers: [
          {
            plannedStructureId: "link:34:10",
            stageId: "advanced-operations",
            plannedStructureType: "link",
            x: 34,
            y: 10,
            kind: "runtime-evaluated",
            occupantType: "runtime-evaluated obstruction",
            reason:
              "Foreign construction site blocks the controller-link tile.",
          },
        ],
      },
      {
        id: "rampart:14:22",
        stageId: "core-economy",
        structureType: "rampart",
        x: 14,
        y: 22,
        minRcl: 4,
        priority: 76,
        strategicWeight: 5,
        controllerEligible: true,
        realized: false,
        underConstruction: false,
        blockers: [],
      },
    ],
  }) as RoomDevelopmentSummary;

type MapLabProps = {
  searchParams: Promise<{ state?: string }>;
};

export default async function MapLab({ searchParams }: MapLabProps) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const mode = params.state === "tampered" ? "tampered" : "current";
  const snapshot = currentSnapshot();
  if (mode === "tampered" && snapshot.roomPlan?.structures?.[0]) {
    snapshot.roomPlan.structures[0].x += 1;
  }

  return (
    <main className="mx-auto min-h-screen w-[min(1380px,calc(100vw-24px))] py-6 sm:py-10">
      <header className="mb-5 flex min-w-0 flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0">
          <div className="text-[0.66rem] font-medium uppercase tracking-[0.13em] text-primary sm:tracking-[0.18em]">
            Development map · deterministic fixture
          </div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Strategic map ·{" "}
            {mode === "current" ? "current authority" : "tampered projection"}
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
            No external state is read or changed. Production always returns 404
            for this route.
          </p>
        </div>
        <nav className="flex shrink-0 gap-2 text-xs" aria-label="Harness state">
          <Link
            aria-current={mode === "current" ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:min-h-9 sm:py-1.5 ${
              mode === "current"
                ? "border-primary/45 bg-primary/[0.12] text-primary shadow-[inset_0_0_0_1px_rgb(235_178_67/0.08)]"
                : "border-white/10 bg-black/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
            }`}
            href="/map-lab?state=current"
          >
            Current
          </Link>
          <Link
            aria-current={mode === "tampered" ? "page" : undefined}
            className={`inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 sm:min-h-9 sm:py-1.5 ${
              mode === "tampered"
                ? "border-primary/45 bg-primary/[0.12] text-primary shadow-[inset_0_0_0_1px_rgb(235_178_67/0.08)]"
                : "border-white/10 bg-black/10 text-muted-foreground hover:border-white/20 hover:text-foreground"
            }`}
            href="/map-lab?state=tampered"
          >
            Tampered
          </Link>
        </nav>
      </header>
      <Card className="lab-panel min-w-0 overflow-hidden rounded-2xl border-white/8 bg-card/65">
        <CardHeader className="border-b border-white/8 p-4 sm:p-6">
          <CardTitle as="h2" className="text-xl">
            E52N38 operator grid
          </CardTitle>
          <CardDescription>
            Deterministic terrain, semantic structures, perimeter, live state,
            and critical queue.
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0 p-3 pt-4 sm:p-6 sm:pt-6">
          <StrategicRoomMap
            snapshot={snapshot}
            development={development()}
            layout="operator"
          />
        </CardContent>
      </Card>
    </main>
  );
}
