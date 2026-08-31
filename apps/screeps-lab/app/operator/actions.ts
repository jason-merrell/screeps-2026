"use server";

import { redirect } from "next/navigation";

import { wakeNativeSnapshotWorker } from "@/lib/github/dispatch";
import { parseSnapshotCommandForm } from "@/lib/operator-command";
import { createClient } from "@/lib/supabase/server";

export async function enqueueSnapshot(formData: FormData) {
  const command = parseSnapshotCommandForm(formData);
  if (!command.ok) redirect("/operator?error=validation");

  const supabase = await createClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) redirect("/login");

  const { data, error } = await supabase.rpc("enqueue_command", command.args);

  if (error || !data?.id) {
    redirect("/operator?error=enqueue");
  }

  let wake = "deferred";
  try {
    wake = (await wakeNativeSnapshotWorker()) ? "dispatched" : "unconfigured";
  } catch (error) {
    console.error("Native snapshot worker wake failed", error);
  }

  redirect(
    `/operator?queued=${encodeURIComponent(data.id)}&wake=${encodeURIComponent(wake)}`,
  );
}
