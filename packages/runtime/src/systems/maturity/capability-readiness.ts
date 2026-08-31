import { MATURE_LINK_TRANSFER_AUTHORITY } from "../economy/mature-energy";

export type MatureCapabilityId =
  | "link-energy-service"
  | "terminal-market-service"
  | "laboratory-reaction-service"
  | "factory-production-service"
  | "observer-intelligence-service"
  | "power-processing-service"
  | "strategic-strike-service";

export interface MatureCapabilityGate {
  readonly id: MatureCapabilityId;
  readonly title: string;
  readonly minRcl: number;
  readonly authorizedAndImplemented: boolean;
  readonly debt: string;
}

/**
 * Code-owned service-readiness manifest.
 *
 * A built structure is footprint evidence, not proof that its service is
 * governed or live. A gate may become true only alongside an authorized FSPM
 * Procedure, an executable implementation, and adversarial verification. This
 * manifest therefore makes present capability debt visible instead of letting
 * mature-room structure counts silently imply actuation.
 */
export const MATURE_CAPABILITY_GATES: readonly MatureCapabilityGate[] =
  Object.freeze([
    Object.freeze({
      id: "link-energy-service",
      title: "Link energy routing",
      minRcl: 5,
      authorizedAndImplemented: MATURE_LINK_TRANSFER_AUTHORITY.authorized,
      debt: MATURE_LINK_TRANSFER_AUTHORITY.reason,
    }),
    Object.freeze({
      id: "terminal-market-service",
      title: "Terminal market and inter-room balancing",
      minRcl: 6,
      authorizedAndImplemented: false,
      debt: "no authorized terminal send, market order, or deal Procedure is present",
    }),
    Object.freeze({
      id: "laboratory-reaction-service",
      title: "Laboratory reactions and boosts",
      minRcl: 6,
      authorizedAndImplemented: false,
      debt: "no authorized reaction, reagent, or boost service Procedure is present",
    }),
    Object.freeze({
      id: "factory-production-service",
      title: "Factory commodity production",
      minRcl: 7,
      authorizedAndImplemented: false,
      debt: "no authorized factory production Procedure is present",
    }),
    Object.freeze({
      id: "observer-intelligence-service",
      title: "Observer intelligence",
      minRcl: 8,
      authorizedAndImplemented: false,
      debt: "no authorized observer intelligence Procedure is present",
    }),
    Object.freeze({
      id: "power-processing-service",
      title: "Power processing",
      minRcl: 8,
      authorizedAndImplemented: false,
      debt: "no authorized power-processing Procedure is present",
    }),
    Object.freeze({
      id: "strategic-strike-service",
      title: "Strategic strike",
      minRcl: 8,
      authorizedAndImplemented: false,
      debt: "no authorized nuker targeting or launch Procedure is present",
    }),
  ] satisfies readonly MatureCapabilityGate[]);

export interface MatureCapabilityReadiness {
  readonly applicable: boolean;
  readonly authorizedAndImplemented: number;
  readonly required: number;
  readonly coveragePercentage: number | null;
  /** Null means no cap is needed. Any unresolved mature gate prevents healthy. */
  readonly operationalHealthCap: number | null;
  readonly debt: readonly MatureCapabilityGate[];
}

export function assessMatureCapabilityReadiness(
  controllerLevel: number,
): MatureCapabilityReadiness {
  const boundedLevel = Math.max(0, Math.min(8, Math.floor(controllerLevel)));
  const requiredGates = MATURE_CAPABILITY_GATES.filter(
    (gate) => gate.minRcl <= boundedLevel,
  );
  const authorizedAndImplemented = requiredGates.filter(
    (gate) => gate.authorizedAndImplemented,
  ).length;
  const debt = requiredGates.filter((gate) => !gate.authorizedAndImplemented);
  if (requiredGates.length === 0) {
    return {
      applicable: false,
      authorizedAndImplemented: 0,
      required: 0,
      coveragePercentage: null,
      operationalHealthCap: null,
      debt: [],
    };
  }

  const coveragePercentage = Math.round(
    (authorizedAndImplemented / requiredGates.length) * 100,
  );
  return {
    applicable: true,
    authorizedAndImplemented,
    required: requiredGates.length,
    coveragePercentage,
    // Zero actuation is degraded. Partial actuation may recover into watch,
    // but cannot become healthy until every currently required gate is live.
    operationalHealthCap:
      debt.length === 0
        ? null
        : Math.min(
            84,
            59 +
              Math.round(
                (authorizedAndImplemented / requiredGates.length) * 25,
              ),
          ),
    debt,
  };
}
