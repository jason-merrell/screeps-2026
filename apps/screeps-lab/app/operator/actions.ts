"use server";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

function readRequired(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

export async function enqueueSnapshot(formData: FormData) {
  const commandKey = readRequired(formData, "commandKey");
  const target = readRequired(formData, "target");
  const shard = readRequired(formData, "shard");
  const roomName = readRequired(formData, "roomName").toUpperCase();

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) redirect("/login");

  const { data, error } = await supabase.rpc("enqueue_command", {
    p_command_key: commandKey,
    p_command_type: "snapshot",
    p_target: target,
    p_shard: shard,
    p_room_name: roomName,
    p_payload: {},
  });

  if (error || !data?.id) {
    redirect("/operator?error=enqueue");
  }

  redirect(`/operator?queued=${encodeURIComponent(data.id)}`);
}
