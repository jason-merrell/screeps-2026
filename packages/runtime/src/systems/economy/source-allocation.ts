export interface SourceCoverage<TSourceId extends string = string> {
  id: TSourceId;
  assignedWork: number;
}

export interface RecoveryHarvesterCandidate {
  name: string;
  work: number;
  rangeBySource: Record<string, number>;
}

export interface ProducerCandidate<TSourceId extends string = string> {
  name: string;
  work: number;
  previousSourceId?: TSourceId;
  rangeBySource: Record<string, number>;
}

export function assignSourceProducers<TSourceId extends string>(
  sourceIds: TSourceId[],
  candidates: ProducerCandidate<TSourceId>[],
): Map<string, TSourceId> {
  const assignments = new Map<string, TSourceId>();
  const claimedSources = new Set<TSourceId>();
  const candidateByName = new Map(candidates.map((candidate) => [candidate.name, candidate]));
  const validSources = new Set(sourceIds);

  // Preserve a valid previous source edge first. Source producers should be
  // stationary infrastructure once established, not participants in a fresh
  // nearest-source auction every tick.
  for (const candidate of [...candidates].sort((a, b) => a.name.localeCompare(b.name))) {
    const sourceId = candidate.previousSourceId;
    if (!sourceId || !validSources.has(sourceId) || claimedSources.has(sourceId)) continue;
    assignments.set(candidate.name, sourceId);
    claimedSources.add(sourceId);
  }

  for (const sourceId of sourceIds) {
    if (claimedSources.has(sourceId)) continue;
    const candidate = [...candidateByName.values()]
      .filter((item) => !assignments.has(item.name))
      .sort((a, b) => {
        const workDifference = b.work - a.work;
        if (workDifference !== 0) return workDifference;
        const rangeDifference =
          (a.rangeBySource[sourceId] ?? Number.MAX_SAFE_INTEGER) -
          (b.rangeBySource[sourceId] ?? Number.MAX_SAFE_INTEGER);
        return rangeDifference || a.name.localeCompare(b.name);
      })[0];
    if (!candidate) continue;
    assignments.set(candidate.name, sourceId);
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
