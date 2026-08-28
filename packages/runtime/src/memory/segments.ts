export const OBSERVABILITY_SEGMENT = 99;

export const OBSERVABILITY_SEGMENT_TARGET_CHARS = 90_000;
export const FSPM_ACTIVITY_MEMORY_LIMIT = 64;
export const FSPM_ACTIVITY_TRACE_LIMIT = 40;
export const FSPM_EVENT_TRACE_LIMIT = 16;
export const FSPM_RETENTION_VERSION = 1;

const requestedSegments = new Set<number>([OBSERVABILITY_SEGMENT]);

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numericField(value: JsonObject, key: string): number {
  const candidate = value[key];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : 0;
}

function recentActivityRows(rows: unknown[], limit: number): unknown[] {
  const activities = rows.flatMap((row) => {
    const activity = asObject(row);
    return activity ? [activity] : [];
  });
  if (activities.length <= limit) return activities;

  const active = activities.filter((activity) => activity.status !== "completed");
  const completed = activities
    .filter((activity) => activity.status === "completed")
    .sort(
      (a, b) =>
        numericField(b, "updatedAt") - numericField(a, "updatedAt") ||
        numericField(b, "completedAt") - numericField(a, "completedAt") ||
        numericField(b, "createdAt") - numericField(a, "createdAt"),
    );
  const completedBudget = Math.max(0, limit - active.length);
  return [...active, ...completed.slice(0, completedBudget)].sort(
    (a, b) =>
      numericField(a, "createdAt") - numericField(b, "createdAt") ||
      String(a.id ?? "").localeCompare(String(b.id ?? "")),
  );
}

function trimTransportRows(trace: JsonObject): void {
  let omittedActivities = 0;
  let omittedEvents = 0;
  const fspm = asObject(trace.fspm);
  if (fspm) {
    for (const row of asArray(fspm.colonies)) {
      const colony = asObject(row);
      if (!colony) continue;

      const activities = asArray(colony.activities);
      const retainedActivities = recentActivityRows(activities, FSPM_ACTIVITY_TRACE_LIMIT);
      omittedActivities += Math.max(0, activities.length - retainedActivities.length);
      colony.activities = retainedActivities;

      const activityEvents = asArray(colony.activityEvents);
      const retainedEvents = activityEvents.slice(-FSPM_EVENT_TRACE_LIMIT);
      omittedEvents += Math.max(0, activityEvents.length - retainedEvents.length);
      colony.activityEvents = retainedEvents;

      for (const taskRow of asArray(colony.tasks)) {
        const task = asObject(taskRow);
        if (!task) continue;
        task.recentActivities = asArray(task.recentActivities).slice(-2);
      }
    }
  }

  const intents = asObject(trace.intents);
  if (intents) {
    intents.acceptedSample = asArray(intents.acceptedSample).slice(0, 12);
    intents.rejectedSample = asArray(intents.rejectedSample).slice(0, 12);
  }

  const transport = asObject(trace.transport) ?? {};
  Object.assign(transport, {
    activityRetentionVersion: FSPM_RETENTION_VERSION,
    activityMemoryLimit: FSPM_ACTIVITY_MEMORY_LIMIT,
    activityTraceLimit: FSPM_ACTIVITY_TRACE_LIMIT,
    eventTraceLimit: FSPM_EVENT_TRACE_LIMIT,
    omittedActivities,
    omittedEvents,
  });
  trace.transport = transport;
}

function stripRepeatedTaskHistory(trace: JsonObject): void {
  const fspm = asObject(trace.fspm);
  if (!fspm) return;
  for (const row of asArray(fspm.colonies)) {
    const colony = asObject(row);
    if (!colony) continue;
    colony.contractHistory = asArray(colony.contractHistory).slice(-4);
    for (const taskRow of asArray(colony.tasks)) {
      const task = asObject(taskRow);
      if (!task) continue;
      task.recentActivities = [];
    }
  }
}

function compactTaskMetadata(trace: JsonObject): void {
  const fspm = asObject(trace.fspm);
  if (!fspm) return;
  for (const row of asArray(fspm.colonies)) {
    const colony = asObject(row);
    if (!colony) continue;
    colony.activities = recentActivityRows(asArray(colony.activities), 24);
    colony.activityEvents = asArray(colony.activityEvents).slice(-8);
    for (const taskRow of asArray(colony.tasks)) {
      const task = asObject(taskRow);
      if (!task) continue;
      delete task.qualityDescription;
      delete task.qualityMetric;
      delete task.kpiMetric;
      task.recentActivities = [];
    }
  }

  const intents = asObject(trace.intents);
  if (intents) {
    intents.acceptedSample = asArray(intents.acceptedSample).slice(0, 4);
    intents.rejectedSample = asArray(intents.rejectedSample).slice(0, 4);
  }

  const transport = asObject(trace.transport);
  if (transport) transport.compacted = true;
}

function minimalTransportTrace(trace: JsonObject, originalChars: number): string {
  const fspm = asObject(trace.fspm);
  return JSON.stringify({
    version: 1,
    tick: typeof trace.tick === "number" ? trace.tick : null,
    cpu: asObject(trace.cpu),
    settlement: asObject(trace.settlement),
    fspm: {
      colonies: [],
      assignments: asArray(fspm?.assignments).slice(0, 8),
    },
    spatial: asObject(trace.spatial),
    movement: asObject(trace.movement),
    intents: {
      proposed: asObject(trace.intents)?.proposed ?? 0,
      accepted: asObject(trace.intents)?.accepted ?? 0,
      rejected: asObject(trace.intents)?.rejected ?? 0,
      proposedByPlanner: asObject(asObject(trace.intents)?.proposedByPlanner),
      proposedByType: asObject(asObject(trace.intents)?.proposedByType),
      acceptedByType: asObject(asObject(trace.intents)?.acceptedByType),
      acceptedSample: [],
      rejectedSample: [],
    },
    transport: {
      activityRetentionVersion: FSPM_RETENTION_VERSION,
      activityMemoryLimit: FSPM_ACTIVITY_MEMORY_LIMIT,
      activityTraceLimit: FSPM_ACTIVITY_TRACE_LIMIT,
      eventTraceLimit: FSPM_EVENT_TRACE_LIMIT,
      truncated: true,
      originalChars,
      reason: "observability payload exceeded segment safety budget",
    },
  });
}

function invalidTransportPayload(originalChars: number, reason: string): string {
  return JSON.stringify({
    version: 1,
    tick: null,
    fspm: { colonies: [], assignments: [] },
    transport: {
      activityRetentionVersion: FSPM_RETENTION_VERSION,
      activityMemoryLimit: FSPM_ACTIVITY_MEMORY_LIMIT,
      activityTraceLimit: FSPM_ACTIVITY_TRACE_LIMIT,
      eventTraceLimit: FSPM_EVENT_TRACE_LIMIT,
      truncated: true,
      originalChars,
      reason,
    },
  });
}

export function fitObservabilityPayload(payload: string): string {
  let trace: JsonObject;
  try {
    const parsed = JSON.parse(payload) as unknown;
    const object = asObject(parsed);
    if (!object) {
      return invalidTransportPayload(payload.length, "observability payload root was not an object");
    }
    trace = object;
  } catch {
    return invalidTransportPayload(payload.length, "observability payload was not valid JSON");
  }

  trimTransportRows(trace);
  let encoded = JSON.stringify(trace);
  if (encoded.length <= OBSERVABILITY_SEGMENT_TARGET_CHARS) return encoded;

  stripRepeatedTaskHistory(trace);
  encoded = JSON.stringify(trace);
  if (encoded.length <= OBSERVABILITY_SEGMENT_TARGET_CHARS) return encoded;

  compactTaskMetadata(trace);
  encoded = JSON.stringify(trace);
  if (encoded.length <= OBSERVABILITY_SEGMENT_TARGET_CHARS) return encoded;

  return minimalTransportTrace(trace, payload.length);
}

export function pruneFspmActivityHistory(): number {
  let removed = 0;
  for (const colony of Object.values(Memory.colonies ?? {})) {
    const activities = colony.fspm?.activities;
    if (!activities) continue;

    const entries = Object.entries(activities);
    if (entries.length <= FSPM_ACTIVITY_MEMORY_LIMIT) continue;

    let excess = entries.length - FSPM_ACTIVITY_MEMORY_LIMIT;
    const completed = entries
      .filter(([, activity]) => activity.status === "completed")
      .sort(
        ([, a], [, b]) =>
          (a.completedAt ?? a.updatedAt ?? a.createdAt) -
            (b.completedAt ?? b.updatedAt ?? b.createdAt) ||
          a.id.localeCompare(b.id),
      );

    for (const [id] of completed) {
      if (excess <= 0) break;
      delete activities[id];
      excess -= 1;
      removed += 1;
    }
  }
  return removed;
}

export function requestMemorySegment(id: number): void {
  if (!Number.isInteger(id) || id < 0 || id > 99) {
    throw new Error(`Invalid RawMemory segment ${id}; expected an integer from 0 through 99`);
  }

  requestedSegments.add(id);
}

export function activateMemorySegments(): void {
  const ids = [...requestedSegments].sort((a, b) => a - b);
  if (ids.length > 10) {
    throw new Error(`RawMemory supports at most 10 active segments; requested ${ids.length}`);
  }

  RawMemory.setActiveSegments(ids);
}

export function writeObservabilitySegment(payload: string): boolean {
  if (RawMemory.segments[OBSERVABILITY_SEGMENT] === undefined) return false;

  pruneFspmActivityHistory();
  const fitted = fitObservabilityPayload(payload);
  RawMemory.segments[OBSERVABILITY_SEGMENT] = fitted;
  return true;
}
