const snapshotTargets = new Set(["ptr", "world", "sim", "headless"]);
const commandKeyPattern = /^[A-Za-z0-9:._-]{8,240}$/;
const shardPattern = /^[A-Za-z0-9_-]{1,48}$/;
const roomPattern = /^[WE]\d+[NS]\d+$/;

export type SnapshotCommandRpcArgs = {
  p_command_key: string;
  p_command_type: "snapshot";
  p_target: string;
  p_shard: string;
  p_room_name: string;
  p_payload: {
    source: "operator-console";
    roomResolution: "operator-selected";
    roomName: string;
  };
};

export type SnapshotCommandValidation =
  | { ok: true; args: SnapshotCommandRpcArgs }
  | { ok: false; field: "commandKey" | "target" | "shard" | "roomName" };

const readString = (formData: FormData, key: string) => {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
};

export function parseSnapshotCommandForm(formData: FormData): SnapshotCommandValidation {
  const commandKey = readString(formData, "commandKey");
  if (!commandKeyPattern.test(commandKey)) return { ok: false, field: "commandKey" };

  const target = readString(formData, "target").toLowerCase();
  if (!snapshotTargets.has(target)) return { ok: false, field: "target" };

  const shard = readString(formData, "shard");
  if (!shardPattern.test(shard)) return { ok: false, field: "shard" };

  const roomName = readString(formData, "roomName").toUpperCase();
  if (!roomPattern.test(roomName)) return { ok: false, field: "roomName" };

  return {
    ok: true,
    args: {
      p_command_key: commandKey,
      p_command_type: "snapshot",
      p_target: target,
      p_shard: shard,
      p_room_name: roomName,
      p_payload: {
        source: "operator-console",
        roomResolution: "operator-selected",
        roomName,
      },
    },
  };
}
