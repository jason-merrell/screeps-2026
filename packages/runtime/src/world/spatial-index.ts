export interface RoomSpatialFacts {
  roomName: string;
  sources: Source[];
  structures: AnyStructure[];
  myStructures: AnyOwnedStructure[];
  constructionSites: ConstructionSite[];
  hostiles: Creep[];
  salvage: Array<Ruin | Tombstone>;
}

export interface SpatialIndexMetrics {
  roomsIndexed: number;
  distanceLookups: number;
  distanceCacheHits: number;
  distanceCacheMisses: number;
}

const objectKey = (object: RoomObject): string => {
  if ("id" in object && typeof object.id === "string") return object.id;
  return `${object.pos.roomName}:${object.pos.x}:${object.pos.y}`;
};

export class TickSpatialIndex {
  readonly byRoom: Record<string, RoomSpatialFacts>;
  readonly metrics: SpatialIndexMetrics;
  private readonly distanceCache = new Map<string, number>();

  constructor(rooms: Room[]) {
    this.byRoom = {};
    this.metrics = {
      roomsIndexed: rooms.length,
      distanceLookups: 0,
      distanceCacheHits: 0,
      distanceCacheMisses: 0,
    };

    for (const room of rooms) {
      this.byRoom[room.name] = {
        roomName: room.name,
        sources: room.find(FIND_SOURCES),
        structures: room.find(FIND_STRUCTURES),
        myStructures: room.find(FIND_MY_STRUCTURES),
        constructionSites: room.find(FIND_MY_CONSTRUCTION_SITES),
        hostiles: room.find(FIND_HOSTILE_CREEPS),
        salvage: [...room.find(FIND_RUINS), ...room.find(FIND_TOMBSTONES)],
      };
    }
  }

  distance(origin: RoomPosition, target: RoomObject): number {
    this.metrics.distanceLookups += 1;
    const key = `${origin.roomName}:${origin.x}:${origin.y}>${objectKey(target)}`;
    const cached = this.distanceCache.get(key);
    if (cached !== undefined) {
      this.metrics.distanceCacheHits += 1;
      return cached;
    }

    this.metrics.distanceCacheMisses += 1;
    const distance = origin.getRangeTo(target.pos);
    this.distanceCache.set(key, distance);
    return distance;
  }

  nearest<T extends RoomObject>(origin: RoomPosition, candidates: readonly T[]): T | null {
    let nearest: T | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const candidate of candidates) {
      const distance = this.distance(origin, candidate);
      if (distance < nearestDistance) {
        nearest = candidate;
        nearestDistance = distance;
      }
    }

    return nearest;
  }
}

export const buildSpatialIndex = (rooms: Room[]): TickSpatialIndex => new TickSpatialIndex(rooms);
