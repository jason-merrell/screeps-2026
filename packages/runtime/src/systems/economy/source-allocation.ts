export interface SourceCoverage<TSourceId extends string = string> {
  id: TSourceId;
  assignedWork: number;
}

export interface RecoveryHarvesterCandidate {
  name: string;
  work: number;
  rangeBySource: Record<string, number>;
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
