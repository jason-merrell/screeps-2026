import { describe, expect, it } from "vitest";

import { parseSnapshotCommandForm } from "./operator-command";

const validForm = () => {
  const form = new FormData();
  form.set("commandKey", "lab:user:snapshot:12345678");
  form.set("target", "PTR");
  form.set("shard", "shard3");
  form.set("roomName", "w39s23");
  return form;
};

describe("snapshot command contract", () => {
  it("propagates the required normalized room to both the RPC argument and metadata", () => {
    const result = parseSnapshotCommandForm(validForm());

    expect(result).toEqual({
      ok: true,
      args: {
        p_command_key: "lab:user:snapshot:12345678",
        p_command_type: "snapshot",
        p_target: "ptr",
        p_shard: "shard3",
        p_room_name: "W39S23",
        p_payload: {
          source: "operator-console",
          roomResolution: "operator-selected",
          roomName: "W39S23",
        },
      },
    });
  });

  it("rejects an invalid room before invoking the RPC", () => {
    const form = validForm();
    form.set("roomName", "owned-colony");

    expect(parseSnapshotCommandForm(form)).toEqual({ ok: false, field: "roomName" });
  });
});
