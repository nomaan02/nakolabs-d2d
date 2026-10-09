"use server";

import { checkEmail, checkFirstName, inviteSentLine } from "@/lib/admin/settings";
import { getOwnProfile } from "@/lib/auth/profile";
import { createServiceClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/**
 * UI-10 F5f (owner A35; owner 2026-10-09: invite by email through the
 * owner's own SMTP, invite only). Canvasser accounts from Settings.
 *
 * - Switching on/off goes through `admin_set_canvasser_active` (migration
 *   029) with the admin's own session; the database refuses anyone but an
 *   admin, and any account but a canvasser.
 * - Inviting uses the service role (server only, `lib/supabase/admin.ts`)
 *   after checking the caller is an active admin. The invite creates the
 *   account; the existing `handle_new_user` trigger makes the profile
 *   (canvasser, active, first name from the invite). Supabase emails the
 *   link through the SMTP set in the dashboard.
 */

export type AccountResult = { ok: true; message: string } | { ok: false; message: string; field?: "name" | "email" };

async function callerIsAdmin(): Promise<boolean> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;
  const profile = await getOwnProfile(supabase, user.id);
  return profile !== null && profile.active && profile.role === "admin";
}

export async function setCanvasserActiveAction(profileId: string, active: boolean): Promise<AccountResult> {
  if (typeof profileId !== "string" || typeof active !== "boolean") return { ok: false, message: "That didn't save. Reopen Settings and try again." };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("admin_set_canvasser_active", { p_profile_id: profileId, p_active: active });
  if (error) {
    if (error.hint === "not_admin") return { ok: false, message: "Only an admin can switch accounts on or off." };
    if (error.hint === "not_canvasser") return { ok: false, message: "Only canvasser accounts can be switched here." };
    if (error.hint === "not_found") return { ok: false, message: "That account no longer exists. Reopen Settings." };
    return { ok: false, message: "That didn't save. Check your signal, then try again." };
  }
  return { ok: true, message: data ? "Switched on." : "Switched off." };
}

export async function inviteCanvasserAction(rawName: string, rawEmail: string): Promise<AccountResult> {
  const name = checkFirstName(typeof rawName === "string" ? rawName : "");
  if (!name.ok) return { ok: false, message: name.message, field: "name" };
  const email = checkEmail(typeof rawEmail === "string" ? rawEmail : "");
  if (!email.ok) return { ok: false, message: email.message, field: "email" };

  if (!(await callerIsAdmin())) return { ok: false, message: "Only an admin can invite canvassers." };

  let service;
  try {
    service = createServiceClient();
  } catch {
    return { ok: false, message: "Invites aren't set up on this server yet. Add the service key, then try again." };
  }

  const { error } = await service.auth.admin.inviteUserByEmail(email.value, { data: { full_name: name.value } });
  if (error) {
    const code = error.code ?? "";
    if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered/i.test(error.message)) {
      return { ok: false, message: `There's already an account for ${email.value}.`, field: "email" };
    }
    if (code === "over_email_send_rate_limit" || error.status === 429) {
      return { ok: false, message: "Too many emails in the last hour. Try again later." };
    }
    if (/sending|smtp|email/i.test(error.message)) {
      return { ok: false, message: "The email didn't send. Check the SMTP settings in Supabase, then try again." };
    }
    return { ok: false, message: "The invite didn't send. Try again." };
  }
  return { ok: true, message: inviteSentLine(email.value) };
}
