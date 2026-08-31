import { beforeEach, describe, expect, it, vi } from "vitest";
import { arbitrateDetailed } from "../../src/intents/arbitrate";
import { execute, intentActorKey } from "../../src/intents/execute";
import { createIntentTrace } from "../../src/intents/trace";
import type { LinkTransferIntent } from "../../src/intents/types";
import {
  activateApprovedColonyGovernance,
  authorizedFspmIntents,
  validateFspmIntentAuthority,
} from "../../src/planning/fspm";

vi.stubGlobal("OK", 0);
vi.stubGlobal("ERR_INVALID_TARGET", -7);
vi.stubGlobal("RESOURCE_ENERGY", "energy");
vi.stubGlobal("STRUCTURE_LINK", "link");
vi.stubGlobal("STRUCTURE_RAMPART", "rampart");
vi.stubGlobal("LINK_LOSS_RATIO", 0.03);

const ROOM = "W1N1";
const transferEnergy = vi.fn((): ScreepsReturnCode => OK);
let objects: Record<string, RoomObject>;

function link(
  id: string,
  roomName = ROOM,
  my = true,
): StructureLink {
  const room = { name: roomName } as Room;
  return {
    id,
    my,
    room,
    pos: { x: id === "source-link" ? 10 : 20, y: 10, roomName },
    structureType: "link",
    cooldown: 0,
    transferEnergy,
    store: {
      getUsedCapacity: () => (id === "source-link" ? 800 : 0),
      getCapacity: () => 800,
      getFreeCapacity: () => (id === "source-link" ? 0 : 800),
    },
  } as unknown as StructureLink;
}

function installGlobals(): void {
  transferEnergy.mockReset().mockReturnValue(OK);
  objects = {
    "source-link": link("source-link"),
    "target-link": link("target-link"),
  };
  Object.assign(globalThis, {
    Game: {
      time: 100,
      creeps: {},
      spawns: {},
      rooms: { [ROOM]: { name: ROOM, controller: { my: true } } },
      getObjectById: (id: string) => objects[id] ?? null,
    },
    Memory: {
      version: 6,
      colonies: { [ROOM]: { roomName: ROOM, discoveredAt: 1 } },
    },
  });
}

function intent(priority = 900, amount = 200): LinkTransferIntent {
  return {
    type: "linkTransfer",
    linkId: "source-link" as Id<StructureLink>,
    targetLinkId: "target-link" as Id<StructureLink>,
    amount,
    priority,
    reason: "exercise governed mature link routing",
    trace: createIntentTrace({
      roomName: ROOM,
      domain: "economy",
      task: "maintain-colony-energy-service",
      // The live catalog deliberately has no linkTransfer-authorized
      // Procedure. Reusing an approved transfer Procedure lets the authority
      // boundary prove it rejects the otherwise well-formed intent by type.
      procedure: "buffer-source-energy",
      workKey: `mature-link:${ROOM}:source-plan`,
    }),
  };
}

describe("link transfer intent", () => {
  beforeEach(() => {
    installGlobals();
    activateApprovedColonyGovernance(ROOM);
  });

  it("arbitrates by source actor so one link cannot execute twice", () => {
    const low = intent(100);
    const high = intent(200);
    const result = arbitrateDetailed([low, high]);

    expect(result.accepted).toEqual([high]);
    expect(result.rejected).toEqual([
      expect.objectContaining({ conflictKey: "link:source-link", loser: low }),
    ]);
    expect(intentActorKey(high)).toBe("link:source-link");
  });

  it("fails governance closed until a versioned Task supersession authorizes link transfer", () => {
    const proposal = intent();
    const authority = authorizedFspmIntents([proposal]);
    expect(authority.accepted).toEqual([]);
    expect(authority.denied).toMatchObject({
      total: 1,
      byCode: { intent_type_mismatch: 1 },
    });
    expect(validateFspmIntentAuthority(proposal)).toMatchObject({
      authorized: false,
      code: "intent_type_mismatch",
    });
  });

  it("executes the technical intent with a post-loss usable-energy KPI target", () => {
    const proposal = intent();

    const execution = execute([proposal]);
    expect(transferEnergy).toHaveBeenCalledWith(objects["target-link"], 200);
    expect(execution.activities).toEqual([
      expect.objectContaining({
        result: OK,
        outcome: {
          metric: "usable link energy received",
          actual: 194,
          target: 194,
          unit: "energy",
        },
      }),
    ]);
  });

  it.each([
    [100, 97],
    [619, 600],
    [800, 776],
  ])(
    "rates a successful %i-energy debit against its %i usable-energy target",
    (amount, usableAmount) => {
      const execution = execute([intent(900, amount)]);

      expect(execution.activities).toEqual([
        expect.objectContaining({
          result: OK,
          outcome: {
            metric: "usable link energy received",
            actual: usableAmount,
            target: usableAmount,
            unit: "energy",
          },
        }),
      ]);
    },
  );

  it("does not claim an energy outcome when the engine rejects the transfer", () => {
    transferEnergy.mockReturnValue(ERR_INVALID_TARGET);

    const [observation] = execute([intent()]).activities;
    expect(observation).toMatchObject({ result: ERR_INVALID_TARGET });
    expect(observation).not.toHaveProperty("outcome");
  });

  it("does not let otherwise valid ownership bypass the missing Procedure authority", () => {
    expect(validateFspmIntentAuthority(intent())).toMatchObject({
      authorized: false,
      code: "intent_type_mismatch",
    });

    const unowned = intent();
    objects["source-link"] = link("source-link", ROOM, false);
    expect(validateFspmIntentAuthority(unowned)).toMatchObject({
      authorized: false,
      code: "intent_type_mismatch",
    });

    objects["source-link"] = link("source-link");
    objects["target-link"] = link("target-link", "W2N2");
    expect(validateFspmIntentAuthority(intent())).toMatchObject({
      authorized: false,
      code: "intent_type_mismatch",
    });
  });
});
