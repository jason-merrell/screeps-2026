export interface SourceCoverage<TSourceId extends string = string> {
  id: TSourceId;
  assignedWork: number;
}

export interface ProducerCandidate<TSourceId extends string = string> {
  name: string;
  work: number;
  rangeBySource: Record<string, number>;
  preferredSourceId?: TSourceId;
}

export interface RecoveryHarvesterCandidate {
  name: string;
  work: number;
  rangeBySource: Record<string, number>;
}

function compareForSource<TSourceId extends string>(
  sourceId: TSourceId,
  left: ProducerCandidate<TSourceId>,
  right: ProducerCandidate<TSourceId>,
): number {
  const workDifference = right.work - left.work;
  if (workDifference !== 0) return workDifference;

  const rangeDifference =
    (left.rangeBySource[sourceId] ?? Number.MAX_SAFE_INTEGER) -
    (right.rangeBySource[sourceId] ?? Number.MAX_SAFE_INTEGER);
  return rangeDifference || left.name.localeCompare(right.name);
}

export function assignSourceProducers<TSourceId extends string>(
  sourceIds: TSourceId[],
  candidates: ProducerCandidate<TSourceId>[],
): Map<string, TSourceId> {
  const assignments = new Map<string, TSourceId>();
  const claimedSources = new Set<TSourceId>();
  const validSources = new Set(sourceIds);

  // Preserve the concrete target of the current governed Activity when it is still valid.
  // Activity continuity is authority; distance is only the fallback for unassigned capacity.
  for (const sourceId of sourceIds) {
    const incumbent = candidates
      .filter(
        (candidate) =>
          !assignments.has(candidate.name) &&
          candidate.preferredSourceId === sourceId &&
          validSources.has(sourceId),
      )
      .sort((left, right) => compareForSource(sourceId, left, right))[0];

    if (!incumbent) continue;
    assignments.set(incumbent.name, sourceId);
    claimedSources.add(sourceId);
  }

  // Fill uncovered sources using the pre-existing deterministic work/range/name policy.
  for (const sourceId of sourceIds) {
    if (claimedSources.has(sourceId)) continue;

    const available = candidates
      .filter((candidate) => !assignments.has(candidate.name))
      .sort((left, right) => compareForSource(sourceId, left, right));
    const producer = available[0];
    if (!producer) continue;

    assignments.set(producer.name, sourceId);
    claimedSources.add(sourceId);
  }

  return assignments;
}

export function assignRecoveryHarvesters<TSourceId extends string>(
  sources: SourceCoverage<TSourceId>[],
  candidates: RecoveryHarvesterCandidate[],
  usefulWorkPerSource = 5,
): Map<string, TSourceId> {
  const assignments = new Map<string, TSourceId>();
  const overflowBySource = new Map<TSourceId, number>();
  const coverage = new Map(sources.map((source) => [source.id, source.assignedWork]));

  for (const candidate of [...candidates].sort((a, b) => a.name.localeCompare(b.name))) {
    const target = sources
      .filter(
        (source) =>
          (coverage.get(source.id) ?? 0) < usefulWorkPerSource &&
          (overflowBySource.get(source.id) ?? 0) < 1,
      )
      .sort((a, b) => {
        const coverageDifference =
          (coverage.get(a.id) ?? 0) - (coverage.get(b.id) ?? 0);
        if (coverageDifference !== 0) return coverageDifference;
        const rangeDifference =
          (candidate.rangeBySource[a.id] ?? Number.MAX_SAFE_INTEGER) -
          (candidate.rangeBySource[b.id] ?? Number.MAX_SAFE_INTEGER);
        return rangeDifference || a.id.localeCompare(b.id);
      })[0];

    if (!target) continue;
    assignments.set(candidate.name, target.id);
    overflowBySource.set(target.id, (overflowBySource.get(target.id) ?? 0) + 1);
    coverage.set(target.id, (coverage.get(target.id) ?? 0) + candidate.work);
  }

  return assignments;
}
