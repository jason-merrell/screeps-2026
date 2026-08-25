import type { RoomPlan } from "../../planning/room-plan";

const ENERGY_PER_CARRY_PART = 50;

export function shouldActivateSourceBuffers(
  controllerLevel: number,
  workforceCount: number,
  sourceCount: number,
): boolean {
  return controllerLevel >= 2 && workforceCount >= Math.max(3, sourceCount + 2);
}

export function requiredCarryParts(pathLength: number, sourceEnergyPerTick = 10): number {
  if (pathLength <= 0 || sourceEnergyPerTick <= 0) return 0;
  const roundTripEnergy = pathLength * 2 * sourceEnergyPerTick;
  return Math.ceil(roundTripEnergy / ENERGY_PER_CARRY_PART);
}

export function plannedSourceRouteLength(plan: RoomPlan, sourceIndex: number): number {
  const spawnToHub = plan.roadGraph.edges.find(
    (edge) => edge.from === "spawn" && edge.to === "hub",
  );
  const hubToSource = plan.roadGraph.edges.find(
    (edge) => edge.from === "hub" && edge.to === `source-${sourceIndex}`,
  );
  return (spawnToHub?.tiles.length ?? 0) + (hubToSource?.tiles.length ?? 0);
}

export function logisticsCoverage(requiredCarry: number, availableCarry: number): number {
  if (requiredCarry <= 0) return 1;
  return Math.max(0, Math.min(1, availableCarry / requiredCarry));
}

export interface TransportReservationNode {
  id: string;
  requiredCarry: number;
}

export interface TransportReservationCandidate {
  name: string;
  carry: number;
  rangeByNode: Record<string, number>;
}

export function reserveTransportCapacity(
  nodes: TransportReservationNode[],
  candidates: TransportReservationCandidate[],
): Map<string, string> {
  const reservations = new Map<string, string>();

  for (const node of [...nodes].sort((a, b) => a.id.localeCompare(b.id))) {
    let reservedCarry = 0;
    const available = candidates
      .filter((candidate) => !reservations.has(candidate.name) && candidate.carry > 0)
      .sort((a, b) =>
        (a.rangeByNode[node.id] ?? Number.POSITIVE_INFINITY) -
          (b.rangeByNode[node.id] ?? Number.POSITIVE_INFINITY) || a.name.localeCompare(b.name),
      );

    for (const candidate of available) {
      if (reservedCarry >= node.requiredCarry) break;
      reservations.set(candidate.name, node.id);
      reservedCarry += candidate.carry;
    }
  }

  return reservations;
}
