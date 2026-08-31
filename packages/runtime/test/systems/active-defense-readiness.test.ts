import { describe, expect, it, vi } from "vitest";
import { FSPM_TASK_CATALOG } from "../../src/planning/fspm-catalog";
import {
  assessDiagnosticTowerTargetFeasibility,
  assessPreparedActiveDefense,
  type DefenseBodyPartEvidence,
  type DefenseTowerEvidence,
  type HostileDefenseEvidence,
  PREPARED_CREEP_COMBAT_AUTHORITY_DEBT,
  preparedDefenseOperationalHealthCap,
  preparedTowerAttackPowerAtRange,
  profileHostileBody,
  rankPreparedDefenseTargets,
  towerDamageAfterOrderedTough,
} from "../../src/systems/defense/active-defense-readiness";
import { towerAttackPowerAtRange } from "../../src/systems/defense/plan";

const part = (
  type: BodyPartConstant,
  boost?: string,
  hits = 100,
): DefenseBodyPartEvidence => ({
  type,
  hits,
  ...(boost ? { boost } : {}),
});

function hostile(
  id: string,
  x: number,
  y: number,
  body: readonly DefenseBodyPartEvidence[],
): HostileDefenseEvidence {
  const hits = body.reduce((total, entry) => total + entry.hits, 0);
  return { id, x, y, hits, hitsMax: body.length * 100, body };
}

const tower = (
  id: string,
  x: number,
  y: number,
  energy = 1_000,
): DefenseTowerEvidence => ({
  id,
  x,
  y,
  energy,
  energyCapacity: 1_000,
});

describe("prepared active-defense evidence", () => {
  it("does not expand the live defense Task or Procedure allowlist", () => {
    const liveDefenseTasks = FSPM_TASK_CATALOG.filter(
      ({ domain }) => domain === "defense",
    );
    expect(liveDefenseTasks).toHaveLength(1);
    expect(liveDefenseTasks[0]).toMatchObject({
      taskKey: "maintain-defensive-readiness",
      procedures: [
        { key: "fund-tower-reserve", allowedIntentTypes: ["transfer"] },
        { key: "repel-hostile", allowedIntentTypes: ["towerAttack"] },
      ],
    });
    expect(JSON.stringify(liveDefenseTasks)).not.toMatch(
      /provide-active-creep-defense|creepAttack|creepHeal|combatMove/,
    );
  });

  it("pins exact tower falloff and cannot drift from the live tower-only model", () => {
    expect(preparedTowerAttackPowerAtRange(Number.NaN)).toBe(0);
    expect(preparedTowerAttackPowerAtRange(0)).toBe(600);
    expect(preparedTowerAttackPowerAtRange(5)).toBe(600);
    expect(preparedTowerAttackPowerAtRange(6)).toBe(570);
    expect(preparedTowerAttackPowerAtRange(19)).toBe(180);
    expect(preparedTowerAttackPowerAtRange(20)).toBe(150);
    expect(preparedTowerAttackPowerAtRange(49)).toBe(150);

    for (let range = 0; range <= 49; range += 1) {
      expect(preparedTowerAttackPowerAtRange(range)).toBe(
        towerAttackPowerAtRange(range),
      );
    }
  });

  it("models boosted hostile output and ignores destroyed combat parts", () => {
    expect(
      profileHostileBody([
        part("attack", "XUH2O"),
        part("ranged_attack", "XKHO2"),
        part("work", "XZH2O"),
        part("heal", "XLHO2"),
        part("claim"),
        part("attack", undefined, 0),
      ]),
    ).toMatchObject({
      evidenceComplete: true,
      activeCombatParts: 5,
      meleeDamagePerTick: 120,
      rangedDamagePerTick: 40,
      dismantleDamagePerTick: 200,
      healPowerPerTick: 48,
      claimParts: 1,
    });

    const unknownBoost = profileHostileBody([part("heal", "UNKNOWN")]);
    expect(unknownBoost).toMatchObject({
      evidenceComplete: false,
      healPowerPerTick: 48,
    });
    expect(unknownBoost.evidenceErrors).toContain(
      "body[0] has unsupported boost UNKNOWN for heal",
    );

    const wrongPartBoost = profileHostileBody([part("attack", "XLHO2")]);
    expect(wrongPartBoost).toMatchObject({
      evidenceComplete: false,
      // Fail-closed analysis uses the strongest legal threat multiplier.
      meleeDamagePerTick: 120,
    });
    expect(wrongPartBoost.evidenceErrors).toContain(
      "body[0] has unsupported boost XLHO2 for attack",
    );
  });

  it("respects body order for boosted TOUGH instead of averaging armor", () => {
    const frontArmored = [
      part("tough", "XGHO2"),
      ...Array.from({ length: 9 }, () => part("attack")),
    ];
    const rearArmored = [
      ...Array.from({ length: 9 }, () => part("attack")),
      part("tough", "XGHO2"),
    ];
    const destroyedArmor = [
      part("tough", "XGHO2", 0),
      ...Array.from({ length: 9 }, () => part("attack")),
    ];

    expect(towerDamageAfterOrderedTough(600, frontArmored)).toBe(367);
    expect(towerDamageAfterOrderedTough(600, rearArmored)).toBe(600);
    expect(towerDamageAfterOrderedTough(600, destroyedArmor)).toBe(600);
  });

  it("subtracts adjacent boosted healing from current-geometry tower pressure", () => {
    const target = hostile(
      "breacher",
      10,
      11,
      Array.from({ length: 10 }, () => part("work")),
    );
    const healer = hostile("healer", 10, 12, [part("heal", "XLHO2")]);

    expect(
      assessDiagnosticTowerTargetFeasibility(
        [tower("tower-1", 10, 10)],
        target,
        [target, healer],
      ),
    ).toMatchObject({
      evidenceComplete: true,
      energizedTowerCount: 1,
      rawVolleyDamage: 600,
      postMitigationVolleyDamage: 600,
      maximumHealingPressure: 48,
      netDamageAtCurrentGeometry: 552,
      preHealDamageReachesCurrentHits: false,
      resolvedVolleyDefeatsTarget: false,
      indicativeVolleysToDefeat: 2,
      pressureState: "sustainable-at-current-geometry",
    });
  });

  it("distinguishes tower DPS feasibility from a healing stalemate", () => {
    const target = hostile("armored", 10, 11, [
      part("tough", "XGHO2"),
      ...Array.from({ length: 9 }, () => part("attack")),
    ]);
    const healers = Array.from({ length: 8 }, (_, index) =>
      hostile(`healer-${index}`, 11, 11, [part("heal", "XLHO2")]),
    );
    const assessment = assessDiagnosticTowerTargetFeasibility(
      [tower("near", 10, 10), tower("far", 30, 30)],
      target,
      [target, ...healers],
    );

    expect(assessment.rawVolleyDamage).toBe(750);
    expect(assessment.postMitigationVolleyDamage).toBe(517);
    expect(assessment.maximumHealingPressure).toBe(384);
    expect(assessment.netDamageAtCurrentGeometry).toBe(133);
    expect(assessment.pressureState).toBe("sustainable-at-current-geometry");

    const stalemate = assessDiagnosticTowerTargetFeasibility(
      [tower("far", 30, 30)],
      target,
      [target, ...healers],
    );
    expect(stalemate.rawVolleyDamage).toBe(150);
    expect(stalemate.netDamageAtCurrentGeometry).toBe(0);
    expect(stalemate.pressureState).toBe("healing-stalemate");
    expect(stalemate.indicativeVolleysToDefeat).toBeNull();
  });

  it("does not call pre-heal overkill decisive when queued healing leaves a survivor", () => {
    const target = hostile("wounded-attacker", 10, 11, [part("attack")]);
    const healers = Array.from({ length: 9 }, (_, index) =>
      hostile(`healer-${index}`, 11, 11, [part("heal")]),
    );
    const assessment = assessDiagnosticTowerTargetFeasibility(
      [tower("far", 30, 30)],
      target,
      [target, ...healers],
    );

    expect(assessment).toMatchObject({
      rawVolleyDamage: 150,
      postMitigationVolleyDamage: 150,
      maximumHealingPressure: 108,
      preHealDamageReachesCurrentHits: true,
      resolvedVolleyDefeatsTarget: false,
      netDamageAtCurrentGeometry: 42,
      indicativeVolleysToDefeat: 3,
      pressureState: "sustainable-at-current-geometry",
    });
  });

  it("ranks a boosted healer above a harmless scout and breaks exact ties by id", () => {
    const healer = hostile("healer", 20, 20, [part("heal", "XLHO2")]);
    const scoutB = hostile("scout-b", 11, 10, [part("move")]);
    const scoutA = hostile("scout-a", 11, 10, [part("move")]);
    expect(
      rankPreparedDefenseTargets(
        [tower("tower", 10, 10)],
        [scoutB, healer, scoutA],
      ).map(({ targetId }) => targetId),
    ).toEqual(["healer", "scout-a", "scout-b"]);
  });

  it("keeps unknown combat evidence at the front for fail-closed attention", () => {
    const unknown = hostile("unknown", 10, 11, [part("heal", "UNKNOWN")]);
    const known = hostile("known", 10, 11, [part("move")]);
    expect(
      rankPreparedDefenseTargets([tower("tower", 10, 10)], [known, unknown])[0],
    ).toMatchObject({ targetId: "unknown", evidenceComplete: false });
  });

  it("reports strategic energy, full-battery reserve, and unapproved authority without fabricating readiness", () => {
    const readiness = assessPreparedActiveDefense({
      controllerLevel: 8,
      towers: [tower("tower-a", 10, 10, 500), tower("tower-b", 12, 10, 750)],
      hostiles: [],
      energy: {
        storageEnergy: 35_000,
        terminalEnergy: 15_000,
        reserveTarget: 50_000,
      },
      safeMode: { state: "available", availableActivations: 2 },
      incomingNukes: [],
    });

    expect(readiness).toMatchObject({
      authority: PREPARED_CREEP_COMBAT_AUTHORITY_DEBT,
      evidenceComplete: true,
      towerCoverage: "no-hostiles-observed",
      towerReserveRatio: 0.625,
      fullBatteryVolleysAvailable: 50,
      strategicEnergyReserve: 50_000,
      strategicEnergyReserveRatio: 1,
      safeModeFallback: "available",
      operationalHealth: { cap: 84 },
    });
    expect(readiness.operationalHealth.debt).toEqual([
      "creep_combat_authority_unapproved",
    ]);
    expect(PREPARED_CREEP_COMBAT_AUTHORITY_DEBT.authorized).toBe(false);
  });

  it("caps an infeasible live defense harder when safe mode and reserves cannot recover it", () => {
    expect(
      preparedDefenseOperationalHealthCap({
        controllerLevel: 8,
        hostileCount: 2,
        towerCoverage: "infeasible",
        towerReserveRatio: 0.1,
        strategicEnergyReserveRatio: 0.2,
        safeModeFallback: "unavailable",
        incomingNukeCount: 0,
        unprotectedNukeCount: 0,
        evidenceComplete: true,
      }),
    ).toEqual({
      cap: 25,
      debt: [
        "creep_combat_authority_unapproved",
        "safe_mode_fallback_unavailable",
        "strategic_energy_reserve_below_half",
        "tower_battery_infeasible",
        "tower_reserve_below_half",
      ],
    });
  });

  it("treats safe mode as creep fallback evidence, never as nuke mitigation", () => {
    const nuke = {
      id: "nuke-1",
      ticksToLand: 2_000,
      criticalAssetsInBlast: 3,
      minimumProtectiveRampartHits: 4_000_000,
      requiredProtectiveRampartHits: 10_000_000,
    };
    const readiness = assessPreparedActiveDefense({
      controllerLevel: 8,
      towers: [tower("tower", 10, 10)],
      hostiles: [],
      energy: {
        storageEnergy: 50_000,
        terminalEnergy: 0,
        reserveTarget: 50_000,
      },
      safeMode: { state: "active", remainingTicks: 10_000 },
      incomingNukes: [nuke],
    });

    expect(readiness.safeModeFallback).toBe("active");
    expect(readiness.unprotectedNukes).toEqual([nuke]);
    expect(readiness.operationalHealth.cap).toBe(25);
    expect(readiness.operationalHealth.debt).toContain(
      "incoming_nuke_protection_gap",
    );
  });

  it("fails closed on missing stores, inconsistent body hits, and invalid safe-mode evidence", () => {
    const malformed: HostileDefenseEvidence = {
      id: "malformed",
      x: 10,
      y: 11,
      hits: 50,
      hitsMax: 100,
      body: [part("attack")],
    };
    const readiness = assessPreparedActiveDefense({
      controllerLevel: 8,
      towers: [tower("tower", 10, 10)],
      hostiles: [malformed],
      energy: { storageEnergy: null, terminalEnergy: 0, reserveTarget: 50_000 },
      safeMode: { state: "available", availableActivations: 0 },
      incomingNukes: [],
    });

    expect(readiness.evidenceComplete).toBe(false);
    expect(readiness.towerCoverage).toBe("indeterminate");
    expect(readiness.strategicEnergyReserveRatio).toBeNull();
    expect(readiness.safeModeFallback).toBe("unknown");
    expect(readiness.operationalHealth.cap).toBe(25);
    expect(readiness.operationalHealth.debt).toContain(
      "defense_evidence_incomplete",
    );
  });

  it("treats pre-unlock stores as not applicable instead of missing evidence", () => {
    const rcl3 = assessPreparedActiveDefense({
      controllerLevel: 3,
      towers: [tower("tower", 10, 10)],
      hostiles: [],
      energy: { storageEnergy: null, terminalEnergy: null, reserveTarget: 0 },
      safeMode: { state: "available", availableActivations: 1 },
      incomingNukes: [],
    });
    expect(rcl3).toMatchObject({
      evidenceComplete: true,
      strategicEnergyReserveApplicable: false,
      strategicEnergyReserve: 0,
      strategicEnergyReserveRatio: null,
    });
    expect(rcl3.operationalHealth.debt).not.toContain(
      "strategic_energy_reserve_below_half",
    );

    const rcl5 = assessPreparedActiveDefense({
      controllerLevel: 5,
      towers: [tower("tower", 10, 10)],
      hostiles: [],
      energy: {
        storageEnergy: 50_000,
        terminalEnergy: null,
        reserveTarget: 50_000,
      },
      safeMode: { state: "available", availableActivations: 1 },
      incomingNukes: [],
    });
    expect(rcl5).toMatchObject({
      evidenceComplete: true,
      strategicEnergyReserveApplicable: true,
      strategicEnergyReserve: 50_000,
      strategicEnergyReserveRatio: 1,
    });
  });

  it("rejects inconsistent cap inputs instead of letting applicability bypass debt", () => {
    expect(
      preparedDefenseOperationalHealthCap({
        controllerLevel: 8,
        hostileCount: 1,
        towerCoverage: "no-hostiles-observed",
        towerReserveRatio: 2,
        strategicEnergyReserveRatio: Number.NaN,
        safeModeFallback: "available",
        incomingNukeCount: 0,
        unprotectedNukeCount: 1,
        evidenceComplete: true,
      }),
    ).toEqual({
      cap: 25,
      debt: [
        "creep_combat_authority_unapproved",
        "defense_evidence_incomplete",
        "incoming_nuke_protection_gap",
      ],
    });
  });

  it("remains pure when Screeps globals are hostile accessors", () => {
    const forbidden = new Proxy(
      {},
      {
        get: () => {
          throw new Error("pure model accessed a Screeps global");
        },
      },
    );
    vi.stubGlobal("Game", forbidden);
    vi.stubGlobal("Memory", forbidden);

    expect(() =>
      assessPreparedActiveDefense({
        controllerLevel: 2,
        towers: [],
        hostiles: [],
        energy: { storageEnergy: null, terminalEnergy: null, reserveTarget: 0 },
        safeMode: { state: "available", availableActivations: 1 },
        incomingNukes: [],
      }),
    ).not.toThrow();
    vi.unstubAllGlobals();
  });
});
