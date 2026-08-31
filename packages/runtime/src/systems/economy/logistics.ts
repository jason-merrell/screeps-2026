import type { RoomPlan } from "../../planning/room-plan";

const ENERGY_PER_CARRY_PART = 50;

export function shouldActivateSourceBuffers(
  controllerLevel: number,
  workforceCount: number,
  sourceCount: number,
): boolean {
  return controllerLevel >= 2 && workforceCount >= Math.max(3, sourceCount + 2);
}

export function requiredCarryParts(
  pathLength: number,
  sourceEnergyPerTick = 10,
): number {
  if (pathLength <= 0 || sourceEnergyPerTick <= 0) return 0;
  const roundTripEnergy = pathLength * 2 * sourceEnergyPerTick;
  return Math.ceil(roundTripEnergy / ENERGY_PER_CARRY_PART);
}

export function plannedSourceRouteLength(
  plan: RoomPlan,
  sourceIndex: number,
): number {
  const spawnToHub = plan.roadGraph.edges.find(
    (edge) => edge.from === "spawn" && edge.to === "hub",
  );
  const hubToSource = plan.roadGraph.edges.find(
    (edge) => edge.from === "hub" && edge.to === `source-${sourceIndex}`,
  );
  return (spawnToHub?.tiles.length ?? 0) + (hubToSource?.tiles.length ?? 0);
}

export function logisticsCoverage(
  requiredCarry: number,
  availableCarry: number,
): number {
  if (requiredCarry <= 0) return 1;
  return Math.max(0, Math.min(1, availableCarry / requiredCarry));
}

export interface TransportReservationNode {
  id: string;
  requiredCarry: number;
}

export interface TransportReservationCandidate {
  baggage?: number;
  name: string;
  carry: number;
  rangeByNode: Record<string, number>;
}

interface TransportReservationSolution {
  readonly actors: number;
  readonly baggage: number;
  readonly coverage: readonly number[];
  readonly overage: number;
  readonly range: number;
  readonly rawCarry: readonly number[];
  readonly reservations: ReadonlyMap<string, string>;
  readonly signature: string;
}

function betterEquivalentReservation(
  left: TransportReservationSolution,
  right: TransportReservationSolution,
): boolean {
  return (
    left.baggage < right.baggage ||
    (left.baggage === right.baggage && left.overage < right.overage) ||
    (left.baggage === right.baggage &&
      left.overage === right.overage &&
      left.actors < right.actors) ||
    (left.baggage === right.baggage &&
      left.overage === right.overage &&
      left.actors === right.actors &&
      left.range < right.range) ||
    (left.baggage === right.baggage &&
      left.overage === right.overage &&
      left.actors === right.actors &&
      left.range === right.range &&
      left.signature < right.signature)
  );
}

function betterFinalReservation(
  left: TransportReservationSolution,
  right: TransportReservationSolution,
  nodes: readonly TransportReservationNode[],
): boolean {
  const leftCoverage = left.coverage.reduce((total, value) => total + value, 0);
  const rightCoverage = right.coverage.reduce(
    (total, value) => total + value,
    0,
  );
  if (leftCoverage !== rightCoverage) return leftCoverage > rightCoverage;

  const weakestDeficit = (solution: TransportReservationSolution): number =>
    Math.max(
      0,
      ...nodes.map(
        (node, index) =>
          (node.requiredCarry - (solution.coverage[index] ?? 0)) /
          node.requiredCarry,
      ),
    );
  const leftWeakestDeficit = weakestDeficit(left);
  const rightWeakestDeficit = weakestDeficit(right);
  if (leftWeakestDeficit !== rightWeakestDeficit) {
    return leftWeakestDeficit < rightWeakestDeficit;
  }
  return betterEquivalentReservation(left, right);
}

export function reserveTransportCapacity(
  nodes: TransportReservationNode[],
  candidates: TransportReservationCandidate[],
): Map<string, string> {
  const normalizedNodes = nodes
    .filter((node) => node.requiredCarry > 0)
    .map((node) => ({
      id: node.id,
      requiredCarry: Math.ceil(node.requiredCarry),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (normalizedNodes.length === 0) return new Map();

  const initial: TransportReservationSolution = {
    actors: 0,
    baggage: 0,
    coverage: normalizedNodes.map(() => 0),
    overage: 0,
    range: 0,
    rawCarry: normalizedNodes.map(() => 0),
    reservations: new Map(),
    signature: "",
  };
  let frontier = new Map<string, TransportReservationSolution>([
    [initial.coverage.join(","), initial],
  ]);
  const candidateNameCounts = new Map<string, number>();
  for (const candidate of candidates) {
    candidateNameCounts.set(
      candidate.name,
      (candidateNameCounts.get(candidate.name) ?? 0) + 1,
    );
  }

  // A creep can serve exactly one source route. Dynamic programming over the
  // bounded owned-room source graph finds a global assignment, preventing a
  // lexicographic greedy choice from fabricating a deficit when an exact fleet
  // permutation exists (for example demands 10/9 with bodies 9/5/5).
  for (const candidate of [...candidates]
    .filter(
      (value) => value.carry > 0 && candidateNameCounts.get(value.name) === 1,
    )
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const carry = Math.ceil(candidate.carry);
    const next = new Map(frontier);
    for (const solution of frontier.values()) {
      for (const [nodeIndex, node] of normalizedNodes.entries()) {
        if ((solution.coverage[nodeIndex] ?? 0) >= node.requiredCarry) continue;
        const previousRawCarry = solution.rawCarry[nodeIndex] ?? 0;
        const rawCarry = [...solution.rawCarry];
        rawCarry[nodeIndex] = previousRawCarry + carry;
        const coverage = [...solution.coverage];
        coverage[nodeIndex] = Math.min(
          node.requiredCarry,
          rawCarry[nodeIndex] ?? 0,
        );
        const reservations = new Map(solution.reservations);
        reservations.set(candidate.name, node.id);
        const range = candidate.rangeByNode[node.id];
        const updated: TransportReservationSolution = {
          actors: solution.actors + 1,
          baggage: solution.baggage + Math.max(0, candidate.baggage ?? 0),
          coverage,
          overage:
            solution.overage +
            Math.max(0, previousRawCarry + carry - node.requiredCarry),
          range:
            solution.range +
            (Number.isFinite(range) ? (range ?? 0) : Number.MAX_SAFE_INTEGER),
          rawCarry,
          reservations,
          signature: `${solution.signature}|${candidate.name}:${node.id}`,
        };
        const key = coverage.join(",");
        const incumbent = next.get(key);
        if (!incumbent || betterEquivalentReservation(updated, incumbent)) {
          next.set(key, updated);
        }
      }
    }
    frontier = next;
  }

  let selected = initial;
  for (const solution of frontier.values()) {
    if (betterFinalReservation(solution, selected, normalizedNodes)) {
      selected = solution;
    }
  }
  return new Map(selected.reservations);
}
