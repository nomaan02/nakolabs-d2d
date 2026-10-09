import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * UI-10 F5e (owner 2026-10-09: invite by email). The link in the invite
 * email lands here with a one-time token. A valid token signs the person
 * in and sends them to /set-password; anything else goes to sign-in with
 * "That link has expired". Only invite and password-reset links are taken.
 */
const ACCEPTED: readonly EmailOtpType[] = ["invite", "recovery"];

export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  const accepted = ACCEPTED.find((value) => value === type);

  if (tokenHash && accepted) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: accepted, token_hash: tokenHash });
    if (!error) redirect("/set-password");
  }
  redirect("/login?error=link");
}
