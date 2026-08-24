import { evaluateSpawnSites } from "../world/spawn-site-evaluator";

type SpawnAdvisorCommand = (roomName: string, limit?: number) => string;

const formatCandidate = (
  candidate: ReturnType<typeof evaluateSpawnSites>["candidates"][number],
  rank: number,
): string =>
  `${rank}. (${candidate.x},${candidate.y}) score=${candidate.score} ` +
  `sources=${candidate.sourceAccess} controller=${candidate.controllerAccess} ` +
  `build=${candidate.buildableArea} exits=${candidate.exitSafety} ` +
  `terrain=${candidate.terrainEfficiency}`;

export const spawnAdvisor: SpawnAdvisorCommand = (roomName, limit = 5) => {
  const evaluation = evaluateSpawnSites(roomName, limit);
  const visual = new RoomVisual(roomName);

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
    `Spawn advisor: ${roomName}`,
    ...evaluation.candidates.map(formatCandidate),
  ];
  const report = lines.join("\n");
  console.log(report);
  return report;
};

export const installSpawnAdvisor = (): void => {
  const globals = globalThis as typeof globalThis & {
    spawnAdvisor?: SpawnAdvisorCommand;
  };
  globals.spawnAdvisor = spawnAdvisor;
};
