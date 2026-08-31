import { createIntentTrace } from "../../intents/trace";
import type { Intent } from "../../intents/types";
import type { RoomPlan, RoomPlanStructure } from "../../planning/room-plan";
import { usableRoomPlanProjection } from "../../planning/room-plan-projection";
import type { WorldSnapshot } from "../../runtime/context";

export const LINK_MIN_TRANSFER_AMOUNT = 100;
export const LINK_ENERGY_LOSS_RATIO = 0.03;
export const CONTROLLER_LINK_ENERGY_TARGET = 600;
export const STORAGE_ENERGY_RESERVE = 20_000;
export const STORAGE_DEFENSE_ENERGY_RESERVE = 2_000;
export const TERMINAL_ENERGY_RESERVE = 10_000;
export const STORAGE_BUFFER_TARGET = 100_000;
export const TERMINAL_BUFFER_TARGET = 20_000;

interface Point {
  x: number;
  y: number;
}

interface SemanticLinkRole extends Point {
  key: string;
  role: "source" | "controller" | "core";
  sourceId?: string;
}

export interface MatureLinkSourceRole {
  sourceId: string;
  planId: string;
}

export interface MatureLinkRoles {
  sources: MatureLinkSourceRole[];
  controllerPlanId: string;
  corePlanId: string;
}

export interface MatureLinkTopologyAssessment {
  status: "ready" | "incomplete" | "fault";
  reason: string;
  roles: MatureLinkRoles | null;
}

export interface MatureLinkServiceAssessment {
  status: "authorization-debt" | "incomplete" | "fault";
  reason: string;
  roles: MatureLinkRoles | null;
}

/**
 * The current approved colony energy-service Task has no Procedure whose
 * allowlist contains linkTransfer. Geometry and transfer policy may be
 * prepared, but live planning must remain fail-closed until an explicitly
 * approved, versioned Task supersession supplies that authority.
 */
export const MATURE_LINK_TRANSFER_AUTHORITY: Readonly<{
  authorized: boolean;
  status: "authorization-debt";
  reason: string;
}> = Object.freeze({
  authorized: false,
  status: "authorization-debt",
  reason:
    "planned mature-link service is withheld because the approved colony energy-service Task has no linkTransfer-authorized Procedure; approve a versioned Task supersession before activation",
});

export interface MatureSourceLinkRoutingStatus {
  sourceId: string;
  link: StructureLink;
  operational: boolean;
  transportCoverage: number;
}

export interface LinkEnergyNode {
  id: string;
  planId: string;
  role: "source" | "controller" | "core";
  energy: number;
  capacity: number;
  cooldown: number;
}

export interface LinkTransferDecision {
  sourceId: string;
  sourcePlanId: string;
  targetId: string;
  targetPlanId: string;
  targetRole: "controller" | "core";
  usableAmount: number;
  amount: number;
}

export type MatureBufferKind = "core-link" | "storage" | "terminal";

export interface MatureBufferState extends Point {
  id: string;
  kind: MatureBufferKind;
  energy: number;
  capacity: number;
}

export interface MatureBufferCreepState extends Point {
  name: string;
  energy: number;
  capacity: number;
  workParts: number;
  carryParts: number;
}

export interface MatureBufferPolicyInput {
  underAttack: boolean;
  criticalEnergyDemand: number;
  reservedCriticalDelivery: number;
  creeps: readonly MatureBufferCreepState[];
  buffers: readonly MatureBufferState[];
}

export interface MatureBufferDecision {
  type: "withdraw" | "deposit";
  creepName: string;
  bufferId: string;
  bufferKind: MatureBufferKind;
  amount: number;
}

const pointKey = (point: Point): string => `${point.x}:${point.y}`;

const rangeBetween = (left: Point, right: Point): number =>
  Math.max(Math.abs(left.x - right.x), Math.abs(left.y - right.y));

function finiteCapacity(value: number | null): number {
  return value === null || !Number.isFinite(value)
    ? 0
    : Math.max(0, Math.floor(value));
}

function uniqueBy<T>(values: readonly T[], key: (value: T) => string): boolean {
  return new Set(values.map(key)).size === values.length;
}

/**
 * Assign semantic roles from the complete planned geometry. The exhaustive
 * search is bounded by Screeps' six-link room limit; stable plan IDs break
 * equal-distance ties without depending on discovery order.
 */
export function deriveMatureLinkRoles(plan: RoomPlan): MatureLinkRoles | null {
  const links = plan.structures
    .filter((structure) => structure.structureType === "link")
    .sort((left, right) => left.id.localeCompare(right.id));
  const storage = plan.structures.filter(
    (structure) => structure.structureType === "storage",
  );
  const controller = plan.anchors.controller?.service;
  const sources = [...plan.anchors.sources].sort((left, right) =>
    left.sourceId.localeCompare(right.sourceId),
  );
  if (
    storage.length !== 1 ||
    !controller ||
    sources.length === 0 ||
    links.length < sources.length + 2 ||
    !uniqueBy(links, (link) => link.id) ||
    !uniqueBy(links, pointKey) ||
    !uniqueBy(sources, (source) => source.sourceId)
  ) {
    return null;
  }
  const coreStorage = storage[0];
  if (!coreStorage) return null;

  const roles: SemanticLinkRole[] = [
    ...sources.map((source) => ({
      key: `source:${source.sourceId}`,
      role: "source" as const,
      sourceId: source.sourceId,
      ...source.container,
    })),
    { key: "controller", role: "controller", ...controller },
    {
      key: "core",
      role: "core",
      x: coreStorage.x,
      y: coreStorage.y,
    },
  ];
  if (!uniqueBy(roles, pointKey)) return null;

  let bestCost = Number.POSITIVE_INFINITY;
  let bestSignature: string | null = null;
  let bestAssignment: RoomPlanStructure[] | null = null;
  const selected: RoomPlanStructure[] = [];
  const used = new Set<string>();

  const search = (roleIndex: number, cost: number): void => {
    if (cost > bestCost) return;
    if (roleIndex >= roles.length) {
      const signature = selected.map((link) => link.id).join("|");
      if (
        cost < bestCost ||
        (cost === bestCost &&
          (bestSignature === null ||
            signature.localeCompare(bestSignature) < 0))
      ) {
        bestCost = cost;
        bestSignature = signature;
        bestAssignment = [...selected];
      }
      return;
    }

    const role = roles[roleIndex];
    if (!role) return;
    for (const link of links) {
      if (used.has(link.id) || rangeBetween(role, link) > 1) continue;
      used.add(link.id);
      selected.push(link);
      search(roleIndex + 1, cost + rangeBetween(role, link));
      selected.pop();
      used.delete(link.id);
    }
  };
  search(0, 0);
  const assignment = bestAssignment as RoomPlanStructure[] | null;
  if (!assignment || assignment.length !== roles.length) return null;

  const sourceRoles: MatureLinkSourceRole[] = [];
  let controllerPlanId: string | undefined;
  let corePlanId: string | undefined;
  for (const [index, role] of roles.entries()) {
    const link = assignment[index];
    if (!link) return null;
    if (rangeBetween(role, link) > 1) return null;
    if (role.role === "source" && role.sourceId) {
      sourceRoles.push({ sourceId: role.sourceId, planId: link.id });
    } else if (role.role === "controller") {
      controllerPlanId = link.id;
    } else if (role.role === "core") {
      corePlanId = link.id;
    }
  }

  return controllerPlanId && corePlanId
    ? { sources: sourceRoles, controllerPlanId, corePlanId }
    : null;
}

/** Surface invalid legacy geometry instead of guessing operational link roles. */
export function assessMatureLinkTopology(
  plan: RoomPlan,
): MatureLinkTopologyAssessment {
  const plannedLinks = plan.structures.filter(
    (structure) => structure.structureType === "link",
  ).length;
  const requiredLinks = plan.anchors.sources.length + 2;
  if (plannedLinks < requiredLinks) {
    return {
      status: "incomplete",
      reason: `planned link topology has ${plannedLinks}/${requiredLinks} source/controller/core roles`,
      roles: null,
    };
  }
  const roles = deriveMatureLinkRoles(plan);
  const planned = plan.structures.filter(
    (structure) => structure.structureType === "link",
  );
  const serviceAnchors: Array<{ key: string; point: Point }> = [
    ...plan.anchors.sources.map((source) => ({
      key: `source:${source.sourceId}`,
      point: source.container,
    })),
    ...(plan.anchors.controller
      ? [{ key: "controller", point: plan.anchors.controller.service }]
      : []),
    ...plan.structures
      .filter((structure) => structure.structureType === "storage")
      .map((structure) => ({ key: "core", point: structure })),
  ];
  const proximity = serviceAnchors
    .map(({ key, point }) => {
      const nearest = planned.reduce(
        (range, link) => Math.min(range, rangeBetween(point, link)),
        Number.POSITIVE_INFINITY,
      );
      return `${key}=${Number.isFinite(nearest) ? nearest : "missing"}`;
    })
    .join(", ");
  const coordinates = planned
    .map((link) => `${link.id}@${pointKey(link)}`)
    .join(", ");
  return roles
    ? {
        status: "ready",
        reason:
          "every source, controller service point, and storage core has one deterministic adjacent planned link",
        roles,
      }
    : {
        status: "fault",
        reason: `planned link geometry is ambiguous or cannot place distinct links within range one of every source buffer, controller service point, and storage core (${proximity}; ${coordinates})`,
        roles: null,
      };
}

/** Geometry evidence plus the live FSPM authorization gate. */
export function assessMatureLinkService(
  plan: RoomPlan,
): MatureLinkServiceAssessment {
  const topology = assessMatureLinkTopology(plan);
  if (topology.status !== "ready") {
    return {
      status: topology.status,
      reason: topology.reason,
      roles: topology.roles,
    };
  }
  return {
    status: MATURE_LINK_TRANSFER_AUTHORITY.status,
    reason: `${topology.reason}; ${MATURE_LINK_TRANSFER_AUTHORITY.reason}`,
    roles: topology.roles,
  };
}

export function usableLinkEnergy(amount: number): number {
  const debit = Math.max(0, Math.floor(amount));
  return Math.max(0, debit - Math.ceil(debit * LINK_ENERGY_LOSS_RATIO));
}

function sourceDebitForUsableEnergy(
  desiredUsable: number,
  maximumDebit: number,
): number {
  let low = 1;
  let high = Math.max(0, Math.floor(maximumDebit));
  if (high <= 0) return 0;
  if (usableLinkEnergy(high) <= desiredUsable) return high;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (usableLinkEnergy(middle) >= desiredUsable) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** Pure, bounded link-battery policy with projected sink reservations. */
export function planLinkTransfers(
  nodes: readonly LinkEnergyNode[],
): LinkTransferDecision[] {
  if (!uniqueBy(nodes, (node) => node.id)) return [];
  const controller = nodes.filter((node) => node.role === "controller");
  const core = nodes.filter((node) => node.role === "core");
  if (
    controller.length > 1 ||
    core.length > 1 ||
    (controller.length === 0 && core.length === 0)
  ) {
    return [];
  }

  const sinks = [controller[0], core[0]].filter(
    (node): node is LinkEnergyNode & { role: "controller" | "core" } =>
      node !== undefined && node.role !== "source",
  );
  const projectedEnergy = new Map(
    sinks.map((sink) => [sink.id, Math.max(0, Math.floor(sink.energy))]),
  );
  const decisions: LinkTransferDecision[] = [];
  const sources = nodes
    .filter(
      (node) =>
        node.role === "source" &&
        node.cooldown === 0 &&
        node.energy >= LINK_MIN_TRANSFER_AMOUNT,
    )
    .sort(
      (left, right) =>
        right.energy - left.energy || left.id.localeCompare(right.id),
    );

  for (const source of sources) {
    for (const sink of sinks) {
      const capacity = finiteCapacity(sink.capacity);
      const desired =
        sink.role === "controller"
          ? Math.min(CONTROLLER_LINK_ENERGY_TARGET, capacity)
          : capacity;
      const current = projectedEnergy.get(sink.id) ?? 0;
      const desiredUsable = Math.max(0, desired - current);
      const amount = sourceDebitForUsableEnergy(
        desiredUsable,
        Math.max(0, Math.floor(source.energy)),
      );
      if (amount < LINK_MIN_TRANSFER_AMOUNT) continue;
      const usableAmount = Math.min(desiredUsable, usableLinkEnergy(amount));
      decisions.push({
        sourceId: source.id,
        sourcePlanId: source.planId,
        targetId: sink.id,
        targetPlanId: sink.planId,
        targetRole: sink.role,
        usableAmount,
        amount,
      });
      projectedEnergy.set(sink.id, current + usableAmount);
      break;
    }
  }

  return decisions;
}

function ownedLinkAt(
  room: Room,
  planned: RoomPlanStructure | null,
): StructureLink | null {
  if (!planned) return null;
  const links = room
    .lookForAt(LOOK_STRUCTURES, planned.x, planned.y)
    .filter(
      (structure): structure is StructureLink =>
        structure.structureType === STRUCTURE_LINK && structure.my,
    );
  return links.length === 1 ? (links[0] ?? null) : null;
}

function linkNode(
  link: StructureLink,
  planId: string,
  role: LinkEnergyNode["role"],
): LinkEnergyNode {
  return {
    id: String(link.id),
    planId,
    role,
    energy: link.store.getUsedCapacity(RESOURCE_ENERGY),
    capacity: finiteCapacity(link.store.getCapacity(RESOURCE_ENERGY)),
    cooldown: link.cooldown,
  };
}

/**
 * Evaluate built source links against the currently built sink subset. Economy
 * uses the strict current-tick flag; spawning uses buffered throughput coverage
 * so one healthy cooldown does not create a redundant lifetime hauler.
 */
export function matureSourceLinkRouting(
  room: Room,
  plan: RoomPlan,
): MatureSourceLinkRoutingStatus[] {
  if (!MATURE_LINK_TRANSFER_AUTHORITY.authorized) return [];
  const roles = assessMatureLinkTopology(plan).roles;
  if (!roles) return [];
  const controller = ownedLinkAt(
    room,
    plannedLink(plan, roles.controllerPlanId),
  );
  const core = ownedLinkAt(room, plannedLink(plan, roles.corePlanId));
  const sinks: LinkEnergyNode[] = [
    ...(controller
      ? [linkNode(controller, roles.controllerPlanId, "controller")]
      : []),
    ...(core ? [linkNode(core, roles.corePlanId, "core")] : []),
  ];
  if (sinks.length === 0) return [];

  return roles.sources.flatMap((sourceRole) => {
    const source = ownedLinkAt(room, plannedLink(plan, sourceRole.planId));
    if (!source) return [];
    const capacity = finiteCapacity(source.store.getCapacity(RESOURCE_ENERGY));
    const free = finiteCapacity(source.store.getFreeCapacity(RESOURCE_ENERGY));
    const potential = planLinkTransfers([
      {
        ...linkNode(source, sourceRole.planId, "source"),
        energy: capacity,
        cooldown: 0,
      },
      ...sinks,
    ]).some((decision) => decision.sourceId === String(source.id));
    if (!potential) {
      return [
        {
          sourceId: sourceRole.sourceId,
          link: source,
          operational: false,
          transportCoverage: 0,
        },
      ];
    }
    const bufferedProduction = Math.max(1, source.cooldown) * 10;
    return [
      {
        sourceId: sourceRole.sourceId,
        link: source,
        operational: source.cooldown === 0 && free > 0,
        transportCoverage:
          source.cooldown === 0
            ? 1
            : Math.max(0, Math.min(1, free / bufferedProduction)),
      },
    ];
  });
}

function bufferReserve(
  buffer: MatureBufferState,
  underAttack: boolean,
): number {
  if (buffer.kind === "core-link") return 0;
  const configured =
    buffer.kind === "terminal"
      ? TERMINAL_ENERGY_RESERVE
      : underAttack
        ? STORAGE_DEFENSE_ENERGY_RESERVE
        : STORAGE_ENERGY_RESERVE;
  return Math.min(configured, Math.floor(buffer.capacity * 0.2));
}

function bufferTarget(buffer: MatureBufferState): number {
  const configured =
    buffer.kind === "terminal" ? TERMINAL_BUFFER_TARGET : STORAGE_BUFFER_TARGET;
  const fraction = buffer.kind === "terminal" ? 0.25 : 0.5;
  return Math.min(configured, Math.floor(buffer.capacity * fraction));
}

function depositTier(buffer: MatureBufferState, energy: number): number {
  if (buffer.kind === "core-link") return Number.POSITIVE_INFINITY;
  if (buffer.kind === "storage" && energy < bufferTarget(buffer)) return 0;
  if (buffer.kind === "terminal" && energy < bufferTarget(buffer)) return 1;
  return buffer.kind === "storage" ? 2 : 3;
}

/**
 * Pure mature-buffer policy. Only CARRY-only performers may deposit, so a
 * builder/upgrader never loses the energy reserved for its WORK parts.
 */
export function planMatureBufferLogistics(
  input: MatureBufferPolicyInput,
): MatureBufferDecision[] {
  if (!uniqueBy(input.buffers, (buffer) => buffer.id)) return [];
  const projected = new Map(
    input.buffers.map((buffer) => [
      buffer.id,
      Math.max(0, Math.floor(buffer.energy)),
    ]),
  );
  let remainingDemand = Math.max(
    0,
    Math.floor(input.criticalEnergyDemand - input.reservedCriticalDelivery),
  );
  const decisions: MatureBufferDecision[] = [];

  for (const creep of [...input.creeps].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (creep.workParts > 0 || creep.carryParts <= 0 || creep.capacity <= 0) {
      continue;
    }
    const carried = Math.max(0, Math.floor(creep.energy));
    if (carried > 0 && remainingDemand > 0) {
      // Preserve this load for the ordinary spawn/tower delivery policy.
      remainingDemand = Math.max(0, remainingDemand - carried);
      continue;
    }

    if (carried > 0) {
      const target = [...input.buffers]
        .filter((buffer) => {
          if (buffer.kind === "core-link") return false;
          return (projected.get(buffer.id) ?? 0) < buffer.capacity;
        })
        .sort((left, right) => {
          const tier =
            depositTier(left, projected.get(left.id) ?? 0) -
            depositTier(right, projected.get(right.id) ?? 0);
          return (
            tier ||
            rangeBetween(creep, left) - rangeBetween(creep, right) ||
            left.id.localeCompare(right.id)
          );
        })[0];
      if (!target) continue;
      const current = projected.get(target.id) ?? 0;
      const tier = depositTier(target, current);
      const desired = tier <= 1 ? bufferTarget(target) : target.capacity;
      const amount = Math.min(carried, Math.max(0, desired - current));
      if (amount <= 0) continue;
      decisions.push({
        type: "deposit",
        creepName: creep.name,
        bufferId: target.id,
        bufferKind: target.kind,
        amount,
      });
      projected.set(target.id, current + amount);
      continue;
    }

    if (remainingDemand <= 0) continue;
    const freeCarry = Math.max(0, Math.floor(creep.capacity - carried));
    const source = [...input.buffers]
      .filter((buffer) => {
        const energy = projected.get(buffer.id) ?? 0;
        return energy > bufferReserve(buffer, input.underAttack);
      })
      .sort((left, right) => {
        const leftKind =
          left.kind === "core-link" ? 0 : left.kind === "storage" ? 1 : 2;
        const rightKind =
          right.kind === "core-link" ? 0 : right.kind === "storage" ? 1 : 2;
        return (
          leftKind - rightKind ||
          rangeBetween(creep, left) - rangeBetween(creep, right) ||
          left.id.localeCompare(right.id)
        );
      })[0];
    if (!source) continue;
    const current = projected.get(source.id) ?? 0;
    const amount = Math.min(
      freeCarry,
      remainingDemand,
      Math.max(0, current - bufferReserve(source, input.underAttack)),
    );
    if (amount <= 0) continue;
    decisions.push({
      type: "withdraw",
      creepName: creep.name,
      bufferId: source.id,
      bufferKind: source.kind,
      amount,
    });
    projected.set(source.id, current - amount);
    remainingDemand -= amount;
  }

  return decisions;
}

function exactPlannedStructure(
  plan: RoomPlan,
  structureType: BuildableStructureConstant,
): RoomPlanStructure | null {
  const planned = plan.structures.filter(
    (structure) => structure.structureType === structureType,
  );
  return planned.length === 1 ? (planned[0] ?? null) : null;
}

function exactOwnedStructure<T extends AnyOwnedStructure>(
  structures: readonly AnyOwnedStructure[],
  planned: Point,
  structureType: StructureConstant,
): T | null {
  const matches = structures.filter(
    (structure) =>
      structure.structureType === structureType &&
      structure.pos.x === planned.x &&
      structure.pos.y === planned.y,
  );
  return matches.length === 1 ? (matches[0] as T) : null;
}

function plannedLink(plan: RoomPlan, planId: string): RoomPlanStructure | null {
  const planned = plan.structures.filter(
    (structure) =>
      structure.id === planId && structure.structureType === "link",
  );
  return planned.length === 1 ? (planned[0] ?? null) : null;
}

function trace(
  roomName: string,
  procedure: "withdraw-buffered-energy" | "buffer-source-energy",
  workKey?: string,
) {
  return createIntentTrace({
    roomName,
    domain: "economy",
    task: "maintain-colony-energy-service",
    procedure,
    ...(workKey ? { workKey } : {}),
  });
}

function isReplaceableIdleIntent(intent: Intent): boolean {
  return (
    intent.type === "move" &&
    (intent.trace?.procedureId.endsWith(":park-surplus-transport") === true ||
      intent.trace?.procedureId.endsWith(":stage-source-transport") === true)
  );
}

function criticalDemandByTarget(
  structures: readonly AnyOwnedStructure[],
  underAttack: boolean,
): Map<string, number> {
  const targets = new Map<string, number>();
  for (const structure of structures) {
    let deficit = 0;
    if (
      structure.structureType === STRUCTURE_SPAWN ||
      structure.structureType === STRUCTURE_EXTENSION
    ) {
      deficit = structure.store.getFreeCapacity(RESOURCE_ENERGY) ?? 0;
    } else if (structure.structureType === STRUCTURE_TOWER) {
      const capacity = finiteCapacity(
        structure.store.getCapacity(RESOURCE_ENERGY),
      );
      const target = underAttack ? capacity : Math.min(400, capacity);
      deficit = Math.max(
        0,
        target - structure.store.getUsedCapacity(RESOURCE_ENERGY),
      );
    }
    if (deficit > 0) targets.set(String(structure.id), deficit);
  }
  return targets;
}

function reservedCriticalDelivery(
  intents: readonly Intent[],
  deficits: ReadonlyMap<string, number>,
): number {
  const remaining = new Map(deficits);
  let reserved = 0;
  for (const intent of intents) {
    if (
      intent.type !== "transfer" ||
      intent.resource !== RESOURCE_ENERGY ||
      !remaining.has(String(intent.targetId))
    ) {
      continue;
    }
    const creep = Game.creeps[intent.creepName];
    if (!creep) continue;
    const targetId = String(intent.targetId);
    const amount = Math.min(
      remaining.get(targetId) ?? 0,
      intent.amount ?? creep.store.getUsedCapacity(RESOURCE_ENERGY),
    );
    if (amount <= 0) continue;
    remaining.set(targetId, (remaining.get(targetId) ?? 0) - amount);
    reserved += amount;
  }
  return reserved;
}

function roomMatureEnergyIntents(
  room: Room,
  world: WorldSnapshot,
  primaryIntents: readonly Intent[],
): Intent[] {
  const projection = usableRoomPlanProjection(
    Memory.colonies[room.name],
    room.name,
  );
  const spatial = world.spatial.byRoom[room.name];
  if (!projection.usable || !spatial) return [];
  const plan = projection.plan;

  const roles = assessMatureLinkTopology(plan).roles;
  const linksByPlanId = new Map<string, StructureLink>();
  const rolePlanIds = roles
    ? [
        ...roles.sources.map((source) => source.planId),
        roles.controllerPlanId,
        roles.corePlanId,
      ]
    : [];
  for (const planId of rolePlanIds) {
    const planned = plannedLink(plan, planId);
    if (!planned) continue;
    const built = exactOwnedStructure<StructureLink>(
      spatial.myStructures,
      planned,
      STRUCTURE_LINK,
    );
    if (built) linksByPlanId.set(planId, built);
  }

  // Keep geometry and pure transfer decisions testable, but do not project a
  // linkTransfer intent while the approved FSPM Task lacks an authorized
  // Procedure for it. Container logistics remains the live continuity path.
  const intents: Intent[] = [];

  const buffers: MatureBufferState[] = [];
  const coreLink = roles ? linksByPlanId.get(roles.corePlanId) : undefined;
  if (coreLink) {
    buffers.push({
      id: String(coreLink.id),
      kind: "core-link",
      x: coreLink.pos.x,
      y: coreLink.pos.y,
      energy: coreLink.store.getUsedCapacity(RESOURCE_ENERGY),
      capacity: finiteCapacity(coreLink.store.getCapacity(RESOURCE_ENERGY)),
    });
  }
  for (const structureType of [
    STRUCTURE_STORAGE,
    STRUCTURE_TERMINAL,
  ] as const) {
    const planned = exactPlannedStructure(plan, structureType);
    if (!planned) continue;
    const built = exactOwnedStructure<StructureStorage | StructureTerminal>(
      spatial.myStructures,
      planned,
      structureType,
    );
    if (!built) continue;
    buffers.push({
      id: String(built.id),
      kind: structureType === STRUCTURE_STORAGE ? "storage" : "terminal",
      x: built.pos.x,
      y: built.pos.y,
      energy: built.store.getUsedCapacity(RESOURCE_ENERGY),
      capacity: finiteCapacity(built.store.getCapacity(RESOURCE_ENERGY)),
    });
  }
  if (buffers.length === 0) return intents;

  const roomPrimary = primaryIntents.filter(
    (intent) =>
      !("creepName" in intent) ||
      Game.creeps[intent.creepName]?.room.name === room.name,
  );
  const primaryByCreep = new Map<string, Intent[]>();
  for (const intent of roomPrimary) {
    if (!("creepName" in intent)) continue;
    primaryByCreep.set(intent.creepName, [
      ...(primaryByCreep.get(intent.creepName) ?? []),
      intent,
    ]);
  }
  const creeps = world.creeps
    .filter((creep) => {
      if (creep.spawning || creep.room.name !== room.name) return false;
      const assignments = primaryByCreep.get(creep.name) ?? [];
      return assignments.every(isReplaceableIdleIntent);
    })
    .map(
      (creep): MatureBufferCreepState => ({
        name: creep.name,
        x: creep.pos.x,
        y: creep.pos.y,
        energy: creep.store.getUsedCapacity(RESOURCE_ENERGY),
        capacity: finiteCapacity(creep.store.getCapacity(RESOURCE_ENERGY)),
        workParts: creep.getActiveBodyparts(WORK),
        carryParts: creep.getActiveBodyparts(CARRY),
      }),
    );
  const underAttack = spatial.hostiles.length > 0;
  const deficits = criticalDemandByTarget(spatial.myStructures, underAttack);
  const criticalEnergyDemand = [...deficits.values()].reduce(
    (total, deficit) => total + deficit,
    0,
  );
  const decisions = planMatureBufferLogistics({
    underAttack,
    criticalEnergyDemand,
    reservedCriticalDelivery: reservedCriticalDelivery(roomPrimary, deficits),
    creeps,
    buffers,
  });
  for (const decision of decisions) {
    if (decision.type === "withdraw") {
      intents.push({
        type: "withdraw",
        creepName: decision.creepName,
        targetId: decision.bufferId as Id<
          StructureStorage | StructureTerminal | StructureLink
        >,
        resource: RESOURCE_ENERGY,
        amount: decision.amount,
        priority: underAttack ? 1_050 : 625,
        reason: `withdraw ${decision.amount} energy from governed ${decision.bufferKind} reserve for active spawn/tower demand`,
        trace: trace(room.name, "withdraw-buffered-energy"),
      });
    } else {
      intents.push({
        type: "transfer",
        creepName: decision.creepName,
        targetId: decision.bufferId as Id<StructureStorage | StructureTerminal>,
        resource: RESOURCE_ENERGY,
        amount: decision.amount,
        priority: 450,
        reason: `preserve surplus hauler energy in the governed ${decision.bufferKind} reserve`,
        trace: trace(room.name, "buffer-source-energy"),
      });
    }
  }

  return intents;
}

/**
 * Activate mature, plan-bound energy infrastructure for every owned room.
 *
 * #132 follow-up: terminal market orders and inter-room balancing intentionally
 * remain outside this local energy-reserve policy.
 */
export function planMatureEnergyCore(
  world: WorldSnapshot,
  primaryIntents: readonly Intent[],
): Intent[] {
  return [...world.rooms]
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((room) => roomMatureEnergyIntents(room, world, primaryIntents));
}
