import {
  evaluateSpawnSites,
  evaluateSpawnSitesFromAnchors,
  type SpawnAdvisorPoint,
  type SpawnSiteEvaluation,
} from "../world/spawn-site-evaluator";

type SpawnAdvisorCommand = (roomName: string, limit?: number) => string;
type SpawnAdvisorOfflineCommand = (
  roomName: string,
  sources: Array<[number, number]>,
  controller: [number, number],
  limit?: number,
) => string;

const formatCandidate = (
  candidate: SpawnSiteEvaluation["candidates"][number],
  rank: number,
): string =>
  `${rank}. (${candidate.x},${candidate.y}) score=${candidate.score} ` +
  `sources=${candidate.sourceAccess} controller=${candidate.controllerAccess} ` +
  `build=${candidate.buildableArea} exits=${candidate.exitSafety} ` +
  `terrain=${candidate.terrainEfficiency}`;

const renderEvaluation = (evaluation: SpawnSiteEvaluation): string => {
  const visual = new RoomVisual(evaluation.roomName);

  for (const [index, candidate] of evaluation.candidates.entries()) {
    const rank = index + 1;
    visual.circle(candidate.x, candidate.y, {
      radius: 0.45,
      fill: "transparent",
      opacity: 0.9,
      strokeWidth: 0.15,
    });
    visual.text(`${rank}`, candidate.x, candidate.y + 0.12, {
      align: "center",
      font: 0.45,
      opacity: 1,
    });
  }

  const lines = [
    `Spawn advisor: ${evaluation.roomName}`,
    ...evaluation.candidates.map(formatCandidate),
  ];
  const report = lines.join("\n");
  console.log(report);
  return report;
};

export const spawnAdvisor: SpawnAdvisorCommand = (roomName, limit = 5) =>
  renderEvaluation(evaluateSpawnSites(roomName, limit));

export const spawnAdvisorOffline: SpawnAdvisorOfflineCommand = (
  roomName,
  sources,
  controller,
  limit = 5,
) => {
  const toPoint = ([x, y]: [number, number]): SpawnAdvisorPoint => ({ x, y });

  return renderEvaluation(
    evaluateSpawnSitesFromAnchors(
      roomName,
      sources.map(toPoint),
      toPoint(controller),
      limit,
    ),
  );
};

export const installSpawnAdvisor = (): void => {
  const globals = globalThis as typeof globalThis & {
    spawnAdvisor?: SpawnAdvisorCommand;
    spawnAdvisorOffline?: SpawnAdvisorOfflineCommand;
  };
  globals.spawnAdvisor = spawnAdvisor;
  globals.spawnAdvisorOffline = spawnAdvisorOffline;
};
