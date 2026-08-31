import { beforeEach, describe, expect, it, vi } from "vitest";
import { activateApprovedColonyGovernance } from "../../src/planning/fspm";
import type { WorldSnapshot } from "../../src/runtime/context";
import {
  allocateTowerBatteryVolley,
  planDefense,
  rankTowerBatteryTargets,
  selectTowerBatteryTarget,
  type TowerBatteryHostile,
  type TowerBatteryMember,
  towerAttackPowerAtRange,
} from "../../src/systems/defense/plan";

const ROOM = "W1N1";

function tower(id: string, x: number, y: number, energy = 100): StructureTower {
  return {
    id,
    structureType: "tower",
    pos: { x, y, roomName: ROOM },
    store: {
      getUsedCapacity: () => energy,
    },
  } as unknown as StructureTower;
}

function hostile(
  id: string,
  x: number,
  y: number,
  hits: number,
  hitsMax: number,
  parts: ReadonlyArray<
    BodyPartConstant | { type: BodyPartConstant; hits: number; boost?: string }
  >,
): Creep {
  return {
    id,
    hits,
    hitsMax,
    pos: { x, y, roomName: ROOM },
    body: parts.map((part) =>
      typeof part === "string"
        ? { type: part, hits: 100 }
        : { type: part.type, hits: part.hits, boost: part.boost },
    ),
  } as unknown as Creep;
}

function batteryTower(
  id: string,
  x: number,
  y: number,
  energy?: number,
): TowerBatteryMember {
  return { id, x, y, ...(energy === undefined ? {} : { energy }) };
}

function batteryHostile(creep: Creep): TowerBatteryHostile {
  return {
    id: creep.id,
    x: creep.pos.x,
    y: creep.pos.y,
    hits: creep.hits,
    hitsMax: creep.hitsMax,
    body: creep.body,
  };
}

function world(room: Room): WorldSnapshot {
  return { rooms: [room] } as unknown as WorldSnapshot;
}

function installGlobals(): void {
  Object.assign(globalThis, {
    FIND_HOSTILE_CREEPS: 1,
    FIND_MY_STRUCTURES: 2,
    STRUCTURE_TOWER: "tower",
    STRUCTURE_SPAWN: "spawn",
    STRUCTURE_STORAGE: "storage",
    STRUCTURE_TERMINAL: "terminal",
    RESOURCE_ENERGY: "energy",
    TOWER_ENERGY_COST: 10,
    Game: { time: 100 },
    Memory: {
      version: 5,
      colonies: {
        [ROOM]: { roomName: ROOM, discoveredAt: 1 },
      },
    },
  });
}

describe("coordinated tower-battery targeting", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    installGlobals();
  });

  it("models official tower attack falloff exactly", () => {
    expect(towerAttackPowerAtRange(0)).toBe(600);
    expect(towerAttackPowerAtRange(5)).toBe(600);
    expect(towerAttackPowerAtRange(6)).toBe(570);
    expect(towerAttackPowerAtRange(19)).toBe(180);
    expect(towerAttackPowerAtRange(20)).toBe(150);
    expect(towerAttackPowerAtRange(40)).toBe(150);
    expect(towerAttackPowerAtRange(Number.NaN)).toBe(0);
  });

  it("focuses a dangerous healer instead of a nearby harmless scout", () => {
    const members = [batteryTower("tower-1", 10, 10)];
    const healer = batteryHostile(
      hostile("healer", 30, 30, 5_000, 5_000, ["heal", "move"]),
    );
    const scout = batteryHostile(hostile("scout", 10, 11, 100, 100, ["move"]));

    const selected = selectTowerBatteryTarget(members, [scout, healer]);
    expect(selected).toMatchObject({
      targetId: "healer",
      threatScore: 100,
      projectedDamage: 150,
    });
  });

  it("orders every invasion-capable active part by defensive consequence", () => {
    const members = [batteryTower("tower-1", 10, 10)];
    const atSameCondition = (
      id: string,
      part: BodyPartConstant,
    ): TowerBatteryHostile =>
      batteryHostile(hostile(id, 10, 15, 1_000, 1_000, [part, "move"]));

    expect(
      rankTowerBatteryTargets(members, [
        atSameCondition("work", "work"),
        atSameCondition("attack", "attack"),
        atSameCondition("ranged", "ranged_attack"),
        atSameCondition("claim", "claim"),
        atSameCondition("heal", "heal"),
      ]).map((entry) => entry.targetId),
    ).toEqual(["heal", "claim", "ranged", "attack", "work"]);
  });

  it("uses current hits and kill pressure to secure a wounded combat threat", () => {
    const members = [batteryTower("tower-1", 10, 10)];
    const fullHealer = batteryHostile(
      hostile("full-healer", 30, 30, 5_000, 5_000, ["heal", "move"]),
    );
    const woundedAttacker = batteryHostile(
      hostile("wounded-attacker", 10, 11, 100, 1_000, ["attack", "move"]),
    );

    const ranking = rankTowerBatteryTargets(members, [
      fullHealer,
      woundedAttacker,
    ]);
    expect(ranking.map((entry) => entry.targetId)).toEqual([
      "wounded-attacker",
      "full-healer",
    ]);
    expect(ranking[0]?.damagePressure).toBe(1);
    expect(ranking[0]?.injuryRatio).toBe(0.9);
  });

  it("discounts boosted TOUGH and subtracts adjacent healing from kill pressure", () => {
    const members = [batteryTower("tower-1", 10, 10)];
    const armored = batteryHostile(
      hostile("armored", 10, 11, 1_000, 1_000, [
        { type: "tough", hits: 100, boost: "XGHO2" },
        ...Array.from({ length: 9 }, () => ({
          type: "attack" as const,
          hits: 100,
        })),
      ]),
    );
    const plain = batteryHostile(
      hostile("plain", 10, 11, 1_000, 1_000, [
        { type: "tough", hits: 100 },
        ...Array.from({ length: 9 }, () => ({
          type: "attack" as const,
          hits: 100,
        })),
      ]),
    );
    const rearArmored = batteryHostile(
      hostile("rear-armored", 10, 11, 1_000, 1_000, [
        ...Array.from({ length: 9 }, () => ({
          type: "attack" as const,
          hits: 100,
        })),
        { type: "tough", hits: 100, boost: "XGHO2" },
      ]),
    );
    const healer = batteryHostile(
      hostile("healer", 10, 12, 100, 100, [
        { type: "heal", hits: 100, boost: "XLHO2" },
      ]),
    );

    const withoutHealer = rankTowerBatteryTargets(members, [armored, plain]);
    expect(
      withoutHealer.find((target) => target.targetId === "armored"),
    ).toMatchObject({
      projectedDamage: 600,
      postMitigationDamage: 367,
      effectiveProjectedDamage: 367,
      projectedHealing: 0,
      netDamage: 367,
    });
    expect(
      withoutHealer.find((target) => target.targetId === "plain"),
    ).toMatchObject({
      postMitigationDamage: 600,
      effectiveProjectedDamage: 600,
      netDamage: 600,
    });
    expect(rankTowerBatteryTargets(members, [rearArmored])[0]).toMatchObject({
      postMitigationDamage: 600,
    });

    const withHealer = rankTowerBatteryTargets(members, [armored, healer]);
    expect(
      withHealer.find((target) => target.targetId === "armored"),
    ).toMatchObject({ projectedHealing: 48, netDamage: 319 });
  });

  it("recognizes edge escape risk when a volley cannot secure a kill", () => {
    const ranking = rankTowerBatteryTargets(
      [batteryTower("tower-1", 1, 20)],
      [batteryHostile(hostile("edge-raider", 1, 21, 5_000, 5_000, ["attack"]))],
    );

    expect(ranking[0]?.edgeEscapeRisk).toBe(0.75);
    expect(ranking[0]?.volleysToKill).toBe(9);
  });

  it("ignores destroyed body parts and breaks exact ties by hostile id", () => {
    const members = [batteryTower("tower-1", 10, 10)];
    const disabledHealer = batteryHostile(
      hostile("disabled", 10, 11, 1_000, 1_000, [
        { type: "heal", hits: 0 },
        "move",
      ]),
    );
    const attacker = batteryHostile(
      hostile("attacker", 10, 12, 1_000, 1_000, ["attack", "move"]),
    );
    expect(
      selectTowerBatteryTarget(members, [disabledHealer, attacker])?.targetId,
    ).toBe("attacker");

    const targetB = batteryHostile(
      hostile("target-b", 10, 11, 1_000, 1_000, ["attack"]),
    );
    const targetA = batteryHostile(
      hostile("target-a", 10, 11, 1_000, 1_000, ["attack"]),
    );
    expect(
      rankTowerBatteryTargets(members, [targetB, targetA]).map(
        (entry) => entry.targetId,
      ),
    ).toEqual(["target-a", "target-b"]);
  });

  it("returns no target for unavailable battery members or dead hostiles", () => {
    const dead = batteryHostile(hostile("dead", 10, 11, 0, 1_000, ["heal"]));
    expect(selectTowerBatteryTarget([], [dead])).toBeNull();
    expect(
      selectTowerBatteryTarget([batteryTower("tower-1", 10, 10)], [dead]),
    ).toBeNull();
  });

  it("issues one governed focus-fire intent per energized tower and skips unavailable actors and targets", () => {
    activateApprovedColonyGovernance(ROOM);
    const towers = [
      tower("tower-b", 10, 10, 100),
      tower("tower-empty", 11, 10, 9),
      tower("tower-a", 12, 10, 10),
    ];
    const hostiles = [
      hostile("scout", 10, 11, 100, 100, ["move"]),
      hostile("healer", 30, 30, 5_000, 5_000, ["heal", "move"]),
      hostile("already-dead", 10, 12, 0, 5_000, ["heal", "heal"]),
    ];
    const room = {
      name: ROOM,
      find: (constant: number) =>
        constant === FIND_HOSTILE_CREEPS ? hostiles : towers,
    } as unknown as Room;

    const intents = planDefense(world(room));
    expect(intents).toHaveLength(2);
    expect(intents.map((intent) => intent.type)).toEqual([
      "towerAttack",
      "towerAttack",
    ]);
    expect(intents).toEqual([
      expect.objectContaining({
        type: "towerAttack",
        towerId: "tower-a",
        targetId: "healer",
        priority: 3000,
        trace: expect.objectContaining({
          taskId: `task:${ROOM}:defense:maintain-defensive-readiness`,
          procedureId: `procedure:${ROOM}:defense:maintain-defensive-readiness:repel-hostile`,
        }),
      }),
      expect.objectContaining({
        type: "towerAttack",
        towerId: "tower-b",
        targetId: "healer",
        priority: 3000,
      }),
    ]);
    expect(intents[0]?.reason).toContain("coordinated tower volley");
    expect(intents[0]?.reason).toContain("projected 300 raw");
  });

  it("reserves one deterministic tower per fragile hostile instead of wasting a six-tower volley", () => {
    activateApprovedColonyGovernance(ROOM);
    const towers = Array.from({ length: 6 }, (_, index) =>
      tower(`tower-${String.fromCharCode(102 - index)}`, 15 - index, 10),
    );
    const hostiles = Array.from({ length: 6 }, (_, index) =>
      hostile(
        `scout-${String.fromCharCode(102 - index)}`,
        15 - index,
        11,
        100,
        100,
        ["move"],
      ),
    );
    const room = {
      name: ROOM,
      find: (constant: number) =>
        constant === FIND_HOSTILE_CREEPS ? hostiles : towers,
    } as unknown as Room;

    const intents = planDefense(world(room));
    expect(
      intents.map((intent) =>
        intent.type === "towerAttack"
          ? [intent.towerId, intent.targetId]
          : [intent.type],
      ),
    ).toEqual([
      ["tower-a", "scout-a"],
      ["tower-b", "scout-b"],
      ["tower-c", "scout-c"],
      ["tower-d", "scout-d"],
      ["tower-e", "scout-e"],
      ["tower-f", "scout-f"],
    ]);
    expect(
      intents.every((intent) => intent.reason.includes("reserved 1 tower")),
    ).toBe(true);

    const forward = allocateTowerBatteryVolley(
      towers.map((member) =>
        batteryTower(member.id, member.pos.x, member.pos.y),
      ),
      hostiles.map(batteryHostile),
    );
    const permuted = allocateTowerBatteryVolley(
      [...towers]
        .reverse()
        .map((member) => batteryTower(member.id, member.pos.x, member.pos.y)),
      [...hostiles].reverse().map(batteryHostile),
    );
    expect(permuted).toEqual(forward);
  });

  it("preserves full focus when ordered boosted TOUGH and healing require the entire battery", () => {
    const towers = Array.from({ length: 6 }, (_, index) =>
      batteryTower(`tower-${index + 1}`, 10 + index, 10),
    );
    const siegeHealer = batteryHostile(
      hostile("siege-healer", 12, 12, 3_000, 3_000, [
        { type: "tough", hits: 100, boost: "XGHO2" },
        { type: "heal", hits: 100, boost: "XLHO2" },
        { type: "heal", hits: 100, boost: "XLHO2" },
        ...Array.from({ length: 27 }, () => "move" as const),
      ]),
    );
    const fragileTargets = Array.from({ length: 5 }, (_, index) =>
      batteryHostile(
        hostile(`scout-${index + 1}`, 11 + index, 11, 100, 100, ["move"]),
      ),
    );

    const assignments = allocateTowerBatteryVolley(towers, [
      ...fragileTargets,
      siegeHealer,
    ]);
    expect(assignments).toHaveLength(6);
    expect(assignments.map((assignment) => assignment.targetId)).toEqual(
      Array.from({ length: 6 }, () => "siege-healer"),
    );
    expect(assignments[0]).toMatchObject({
      reservedTowerCount: 6,
      reservedRawDamage: 3_600,
      reservedPostMitigationDamage: 3_367,
      projectedHealing: 96,
      reservedNetDamage: 3_000,
      resolvedVolleyDefeatsTarget: true,
    });
  });

  it("secures lower-ranked kills before spending leftovers on a healing stalemate", () => {
    const towers = [
      batteryTower("tower-1", 15, 15),
      batteryTower("tower-2", 14, 15),
      batteryTower("tower-3", 15, 14),
      batteryTower("tower-4", 14, 14),
      batteryTower("tower-5", 13, 15),
      batteryTower("tower-6", 15, 13),
    ];
    const brick = batteryHostile(
      hostile(
        "boosted-brick",
        10,
        10,
        5_000,
        5_000,
        Array.from({ length: 50 }, () => ({
          type: "attack" as const,
          hits: 100,
          boost: "XUH2O",
        })),
      ),
    );
    const healerPositions = [
      [9, 9],
      [9, 10],
      [10, 9],
      [11, 10],
    ] as const;
    const healers = healerPositions.map(([x, y], index) =>
      batteryHostile(
        hostile(`healer-${index + 1}`, x, y, 5_000, 5_000, [
          ...Array.from({ length: 20 }, () => ({
            type: "heal" as const,
            hits: 100,
            boost: "XLHO2",
          })),
          ...Array.from({ length: 30 }, () => "move" as const),
        ]),
      ),
    );
    const raiderPositions = [
      [15, 15],
      [15, 14],
      [14, 15],
      [14, 14],
      [15, 13],
    ] as const;
    const raiders = raiderPositions.map(([x, y], index) =>
      batteryHostile(
        hostile(`raider-${String.fromCharCode(97 + index)}`, x, y, 100, 100, [
          "attack",
        ]),
      ),
    );
    const hostiles = [brick, ...healers, ...raiders];

    expect(rankTowerBatteryTargets(towers, hostiles)[0]).toMatchObject({
      targetId: "boosted-brick",
      netDamage: 0,
    });
    const assignments = allocateTowerBatteryVolley(towers, hostiles);
    expect(
      assignments.map(({ towerId, targetId, resolvedVolleyDefeatsTarget }) => [
        towerId,
        targetId,
        resolvedVolleyDefeatsTarget,
      ]),
    ).toEqual([
      ["tower-1", "raider-a", true],
      ["tower-2", "raider-b", true],
      ["tower-3", "raider-c", true],
      ["tower-4", "raider-d", true],
      ["tower-5", "raider-e", true],
      ["tower-6", "boosted-brick", false],
    ]);
    expect(
      allocateTowerBatteryVolley(
        [...towers].reverse(),
        [...hostiles].reverse(),
      ),
    ).toEqual(assignments);
  });

  it("pins an all-zero-net healing battery with one tower above reserve and otherwise conserves", () => {
    const towers = Array.from({ length: 6 }, (_, index) =>
      batteryTower(`tower-${index + 1}`, 10 + index, 10, 1_000),
    );
    const healLocked = [
      { id: "healer-a", x: 12, y: 12 },
      { id: "healer-b", x: 13, y: 12 },
      { id: "healer-c", x: 12, y: 13 },
    ].map(({ id, x, y }) =>
      batteryHostile(
        hostile(
          id,
          x,
          y,
          5_000,
          5_000,
          Array.from({ length: 50 }, () => ({
            type: "heal" as const,
            hits: 100,
            boost: "XLHO2",
          })),
        ),
      ),
    );

    expect(
      rankTowerBatteryTargets(towers, healLocked).every(
        (target) => target.netDamage === 0,
      ),
    ).toBe(true);
    const pin = allocateTowerBatteryVolley(towers, healLocked);
    expect(pin).toHaveLength(1);
    expect(pin[0]).toMatchObject({
      towerId: "tower-1",
      reservedTowerCount: 1,
      reservedNetDamage: 0,
      resolvedVolleyDefeatsTarget: false,
    });

    const reserveOnly = towers.map((member) => ({ ...member, energy: 510 }));
    expect(allocateTowerBatteryVolley(reserveOnly, healLocked)).toHaveLength(1);
    const belowReserve = towers.map((member) => ({ ...member, energy: 509 }));
    expect(allocateTowerBatteryVolley(belowReserve, healLocked)).toEqual([]);
    expect(
      allocateTowerBatteryVolley(
        [...belowReserve].reverse(),
        [...healLocked].reverse(),
      ),
    ).toEqual([]);
  });

  it("keeps full positive pressure on an existential boosted threat instead of chasing scouts", () => {
    const towers = [
      batteryTower("tower-1", 15, 15),
      batteryTower("tower-2", 14, 15),
      batteryTower("tower-3", 15, 14),
      batteryTower("tower-4", 14, 14),
      batteryTower("tower-5", 13, 15),
      batteryTower("tower-6", 15, 13),
    ];
    const boostedAttacker = {
      ...batteryHostile(
        hostile(
          "spawn-adjacent-attacker",
          10,
          10,
          4_000,
          5_000,
          Array.from({ length: 50 }, (_, index) => ({
            type: "attack" as const,
            hits: index < 40 ? 100 : 0,
            boost: "XUH2O",
          })),
        ),
      ),
      assetRange: 0,
    };
    const scouts = Array.from({ length: 5 }, (_, index) =>
      batteryHostile(
        hostile(
          `scout-${index + 1}`,
          14 + (index % 2),
          13 + (index % 3),
          100,
          100,
          ["move"],
        ),
      ),
    );

    expect(
      rankTowerBatteryTargets(towers, [boostedAttacker, ...scouts])[0],
    ).toMatchObject({
      targetId: "spawn-adjacent-attacker",
      netDamage: 3_600,
      volleysToKill: 2,
    });
    const assignments = allocateTowerBatteryVolley(towers, [
      ...scouts,
      boostedAttacker,
    ]);
    expect(assignments).toHaveLength(6);
    expect(assignments.map((assignment) => assignment.targetId)).toEqual(
      Array.from({ length: 6 }, () => "spawn-adjacent-attacker"),
    );
    expect(assignments[0]).toMatchObject({
      reservedTowerCount: 6,
      reservedRawDamage: 3_600,
      reservedNetDamage: 3_600,
      resolvedVolleyDefeatsTarget: false,
    });
  });

  it("fails closed on duplicate replay IDs instead of selecting by input order", () => {
    const target = batteryHostile(
      hostile("target", 10, 11, 100, 100, ["attack"]),
    );
    const duplicateTowers = [
      batteryTower("tower", 10, 10),
      batteryTower("tower", 40, 40),
    ];
    const duplicateTargets = [target, { ...target, x: 40, y: 40 }];

    expect(allocateTowerBatteryVolley(duplicateTowers, [target])).toEqual([]);
    expect(
      allocateTowerBatteryVolley([...duplicateTowers].reverse(), [target]),
    ).toEqual([]);
    expect(
      allocateTowerBatteryVolley(
        [batteryTower("tower", 10, 10)],
        duplicateTargets,
      ),
    ).toEqual([]);
    expect(
      allocateTowerBatteryVolley(
        [batteryTower("tower", 10, 10)],
        [...duplicateTargets].reverse(),
      ),
    ).toEqual([]);
  });
});
