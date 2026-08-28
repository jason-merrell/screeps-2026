import { fspmTaskDefinition } from "../planning/fspm-catalog";
import type {
  ColonyFspmPortfolio,
  FspmActivityRecord,
  FspmActivityStatus,
} from "../planning/fspm";

export const FSPM_ACTIVITY_ARCHIVE_SEGMENT = 98;
export const FSPM_ACTIVITY_MEMORY_LIMIT = 64;
export const FSPM_ACTIVITY_STALE_ON_HOLD_TICKS = 1500;
export const FSPM_ACTIVITY_ARCHIVE_RECORD_LIMIT = 128;
export const FSPM_ACTIVITY_ARCHIVE_TARGET_CHARS = 90_000;
export const FSPM_ACTIVITY_ARCHIVE_VERSION = 1;

export type FspmActivityResolutionDisposition = "cancelled" | "migrated";

export interface FspmActivityResolution {
  disposition: FspmActivityResolutionDisposition;
  resolvedAt: number;
  reason: string;
  replacementActivityId?: string;
}

export interface FspmArchivedActivityRecord {
  roomName: string;
  activity: FspmActivityRecord;
  resolution: FspmActivityResolution;
}

interface FspmActivityArchivePayload {
  version: typeof FSPM_ACTIVITY_ARCHIVE_VERSION;
  updatedAt: number;
  records: FspmArchivedActivityRecord[];
}

export interface FspmActivityRetentionReport {
  tick: number;
  archiveSegment: number;
  archiveAvailable: boolean;
  archiveRecords: number;
  archived: number;
  cancelled: number;
  migrated: number;
  archiveBlocked: number;
  activeActivities: number;
  overLimitActivities: number;
  latestResolution: {
    activityId: string;
    taskId: string;
    disposition: FspmActivityResolutionDisposition;
    resolvedAt: number;
    reason: string;
    replacementActivityId?: string;
  } | null;
}

interface ActivityEvidence extends FspmActivityRecord {
  workKey?: string;
  currentTargetKey?: string;
}

let lastRetentionReport: FspmActivityRetentionReport = {
  tick: 0,
  archiveSegment: FSPM_ACTIVITY_ARCHIVE_SEGMENT,
  archiveAvailable: false,
  archiveRecords: 0,
  archived: 0,
  cancelled: 0,
  migrated: 0,
  archiveBlocked: 0,
  activeActivities: 0,
  overLimitActivities: 0,
  latestResolution: null,
};

function emptyArchive(): FspmActivityArchivePayload {
  return {
    version: FSPM_ACTIVITY_ARCHIVE_VERSION,
    updatedAt: Game.time,
    records: [],
  };
}

function parseArchive(raw: string): FspmActivityArchivePayload | null {
  if (!raw) return emptyArchive();
  try {
    const parsed = JSON.parse(raw) as Partial<FspmActivityArchivePayload>;
    if (parsed.version === undefined && parsed.records === undefined) return emptyArchive();
    if (parsed.version !== FSPM_ACTIVITY_ARCHIVE_VERSION || !Array.isArray(parsed.records)) {
      return null;
    }
    return {
      version: FSPM_ACTIVITY_ARCHIVE_VERSION,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : 0,
      records: parsed.records,
    };
  } catch {
    return null;
  }
}

function readArchive(): FspmActivityArchivePayload | null {
  if (typeof RawMemory === "undefined") return null;
  const raw = RawMemory.segments[FSPM_ACTIVITY_ARCHIVE_SEGMENT];
  if (raw === undefined) return null;
  return parseArchive(raw);
}

function archiveContains(
  archive: FspmActivityArchivePayload,
  activityId: string,
): boolean {
  return archive.records.some((record) => record.activity.id === activityId);
}

function persistArchive(archive: FspmActivityArchivePayload): boolean {
  if (archive.records.length > FSPM_ACTIVITY_ARCHIVE_RECORD_LIMIT) return false;
  archive.updatedAt = Game.time;
  const encoded = JSON.stringify(archive);
  if (encoded.length > FSPM_ACTIVITY_ARCHIVE_TARGET_CHARS) return false;
  RawMemory.segments[FSPM_ACTIVITY_ARCHIVE_SEGMENT] = encoded;
  const verified = readArchive();
  return verified !== null && archive.records.every((record) => archiveContains(verified, record.activity.id));
}

function snapshotActivity(activity: FspmActivityRecord): FspmActivityRecord {
  return JSON.parse(JSON.stringify(activity)) as FspmActivityRecord;
}

function archiveResolution(
  roomName: string,
  activity: FspmActivityRecord,
  resolution: FspmActivityResolution,
): boolean {
  const archive = readArchive();
  if (!archive) return false;
  if (archiveContains(archive, activity.id)) return true;

  archive.records.push({
    roomName,
    activity: snapshotActivity(activity),
    resolution: { ...resolution },
  });
  archive.records.sort(
    (a, b) =>
      a.resolution.resolvedAt - b.resolution.resolvedAt ||
      a.activity.createdAt - b.activity.createdAt ||
      a.activity.id.localeCompare(b.activity.id),
  );
  return persistArchive(archive);
}

function workIdentity(activity: FspmActivityRecord): string | null {
  const evidence = activity as ActivityEvidence;
  if (evidence.workKey) return `work:${evidence.workKey}`;
  if (evidence.currentTargetKey) return `target:${evidence.currentTargetKey}`;
  return null;
}

function migrationReplacement(
  portfolio: ColonyFspmPortfolio,
  activity: FspmActivityRecord,
): FspmActivityRecord | undefined {
  const identity = workIdentity(activity);
  if (!identity) return undefined;

  return Object.values(portfolio.activities ?? {})
    .filter((candidate) => {
      if (candidate.id === activity.id || candidate.taskId !== activity.taskId) return false;
      if (candidate.status === "completed") return false;
      if (workIdentity(candidate) !== identity) return false;
      return (
        candidate.status === "in_progress" ||
        candidate.updatedAt > activity.updatedAt ||
        (candidate.updatedAt === activity.updatedAt && candidate.createdAt > activity.createdAt)
      );
    })
    .sort(
      (a, b) =>
        Number(b.status === "in_progress") - Number(a.status === "in_progress") ||
        b.updatedAt - a.updatedAt ||
        b.createdAt - a.createdAt ||
        b.id.localeCompare(a.id),
    )[0];
}

function resolutionForActivity(
  portfolio: ColonyFspmPortfolio,
  activity: FspmActivityRecord,
): FspmActivityResolution | null {
  if (activity.status !== "on_hold") return null;

  const replacement = migrationReplacement(portfolio, activity);
  if (replacement) {
    return {
      disposition: "migrated",
      resolvedAt: Game.time,
      reason: `newer Activity ${replacement.id} owns the same governed work identity; prior On Hold occurrence is resolved without KPI`,
      replacementActivityId: replacement.id,
    };
  }

  const task = portfolio.tasks[activity.taskId];
  if (!task) {
    return {
      disposition: "cancelled",
      resolvedAt: Game.time,
      reason: "parent Task definition is unavailable; orphaned On Hold Activity cannot legitimately resume and is resolved without KPI",
    };
  }

  if (!fspmTaskDefinition(task.domain, task.taskKey)) {
    return {
      disposition: "cancelled",
      resolvedAt: Game.time,
      reason: `legacy Task ${task.taskKey} is not emit-able by the canonical planner catalog; held occurrence is resolved without KPI before Task retirement`,
    };
  }

  const age = Math.max(0, Game.time - activity.updatedAt);
  if (age >= FSPM_ACTIVITY_STALE_ON_HOLD_TICKS) {
    const assigneeUnavailable = !activity.assignee.includes(":") && !Game.creeps[activity.assignee];
    return {
      disposition: "cancelled",
      resolvedAt: Game.time,
      reason: `On Hold Activity did not resume for ${age} ticks (one standard creep-lifetime horizon)${assigneeUnavailable ? " and its original assignee no longer exists" : ""}; the occurrence is expired without KPI and any future demand must instantiate or resume current governed work`,
    };
  }

  return null;
}

function countActiveActivities(): { total: number; overLimit: number } {
  let total = 0;
  let overLimit = 0;
  for (const colony of Object.values(Memory.colonies ?? {})) {
    const count = Object.keys(colony.fspm?.activities ?? {}).length;
    total += count;
    overLimit += Math.max(0, count - FSPM_ACTIVITY_MEMORY_LIMIT);
  }
  return { total, overLimit };
}

export function reconcileFspmActivityRetention(): FspmActivityRetentionReport {
  const archive = readArchive();
  const report: FspmActivityRetentionReport = {
    tick: Game.time,
    archiveSegment: FSPM_ACTIVITY_ARCHIVE_SEGMENT,
    archiveAvailable: archive !== null,
    archiveRecords: archive?.records.length ?? 0,
    archived: 0,
    cancelled: 0,
    migrated: 0,
    archiveBlocked: 0,
    activeActivities: 0,
    overLimitActivities: 0,
    latestResolution: null,
  };

  if (archive) {
    for (const colony of Object.values(Memory.colonies ?? {})) {
      const portfolio = colony.fspm;
      if (!portfolio?.activities) continue;

      const candidates = Object.values(portfolio.activities)
        .filter((activity) => activity.status === "on_hold")
        .sort(
          (a, b) =>
            a.updatedAt - b.updatedAt ||
            a.createdAt - b.createdAt ||
            a.id.localeCompare(b.id),
        );

      for (const activity of candidates) {
        const resolution = resolutionForActivity(portfolio, activity);
        if (!resolution) continue;
        if (!archiveResolution(colony.roomName, activity, resolution)) {
          report.archiveBlocked += 1;
          continue;
        }

        // Two-phase authority handoff: only evict after the persistent segment
        // can be read back with the exact Activity ID present.
        const verified = readArchive();
        if (!verified || !archiveContains(verified, activity.id)) {
          report.archiveBlocked += 1;
          continue;
        }

        delete portfolio.activities[activity.id];
        report.archived += 1;
        report[resolution.disposition] += 1;
        report.latestResolution = {
          activityId: activity.id,
          taskId: activity.taskId,
          disposition: resolution.disposition,
          resolvedAt: resolution.resolvedAt,
          reason: resolution.reason,
          ...(resolution.replacementActivityId
            ? { replacementActivityId: resolution.replacementActivityId }
            : {}),
        };
      }
    }
  }

  const finalArchive = readArchive();
  const counts = countActiveActivities();
  report.archiveRecords = finalArchive?.records.length ?? 0;
  report.activeActivities = counts.total;
  report.overLimitActivities = counts.overLimit;
  lastRetentionReport = report;
  return { ...report, latestResolution: report.latestResolution ? { ...report.latestResolution } : null };
}

export function fspmActivityArchiveSummary(): FspmActivityRetentionReport {
  const archive = readArchive();
  return {
    ...lastRetentionReport,
    archiveAvailable: archive !== null,
    archiveRecords: archive?.records.length ?? 0,
    latestResolution: lastRetentionReport.latestResolution
      ? { ...lastRetentionReport.latestResolution }
      : null,
  };
}

export function readFspmActivityArchive(): readonly FspmArchivedActivityRecord[] {
  const archive = readArchive();
  return archive ? archive.records.map((record) => ({
    roomName: record.roomName,
    activity: snapshotActivity(record.activity),
    resolution: { ...record.resolution },
  })) : [];
}

export function isGovernedActivityStatus(value: string): value is FspmActivityStatus {
  return (
    value === "not_started" ||
    value === "in_progress" ||
    value === "on_hold" ||
    value === "completed"
  );
}
