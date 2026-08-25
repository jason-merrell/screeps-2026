"use server";

import { redirect } from "next/navigation";

import { siteUrl } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

export async function sendMagicLink(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  if (!email?.includes("@")) redirect("/login?error=invalid-email");

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${siteUrl}/auth/callback`,
      shouldCreateUser: true,
    },
  });

  if (error) redirect("/login?error=signin");
  redirect("/login?sent=1");
}
