import { describe, expect, it } from "vitest";
import { evaluateStartRoom, rankStartRooms } from "../../../scripts/lib/start-room-recommender.mjs";

const plainTerrain = "0".repeat(2500);

describe("start room recommender", () => {
  it("scores a deterministic best spawn tile", () => {
    const evaluation = evaluateStartRoom({
      room: "E1N1",
      shard: "shard3",
      terrain: plainTerrain,
      sources: [
        { x: 10, y: 10, energyCapacity: 1500 },
        { x: 40, y: 40, energyCapacity: 1500 },
      ],
      controller: { x: 25, y: 10 },
    });

    expect(evaluation.bestSpawn).toMatchObject({
      x: 17,
      y: 17,
      score: 92.8,
      sourceAccess: 82.5,
      controllerAccess: 93,
      buildableArea: 100,
      exitSafety: 100,
      terrainEfficiency: 100,
    });
  });

  it("ranks rooms by their best spawn score with deterministic ties", () => {
    const ranking = rankStartRooms([
      {
        room: "E1N1",
        shard: "shard3",
        terrain: plainTerrain,
        sources: [
          { x: 10, y: 10 },
          { x: 40, y: 40 },
        ],
        controller: { x: 25, y: 10 },
      },
      {
        room: "E1N2",
        shard: "shard3",
        terrain: plainTerrain,
        sources: [
          { x: 10, y: 10 },
          { x: 12, y: 10 },
        ],
        controller: { x: 40, y: 40 },
      },
    ]);

    expect(ranking.map(({ room, score }) => ({ room, score }))).toEqual([
      { room: "E1N2", score: 94.6 },
      { room: "E1N1", score: 92.8 },
    ]);
  });
});
