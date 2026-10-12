"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile } from "@/lib/auth/profile";
import { homeForRole } from "@/lib/auth/roles";
import { loginEmail } from "@/lib/auth/username";

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function signIn(formData: FormData) {
  // CRM-5 U: the box takes a username or an email (lib/auth/username.ts).
  const email = loginEmail(readString(formData, "login") || readString(formData, "email"));
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    redirect("/login?error=credentials");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=credentials");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?error=credentials");
  }

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile || !profile.active) {
    redirect("/account-pending");
  }

  redirect(homeForRole(profile.role));
}

/**
 * UI-10 F5e (owner 2026-10-09: invite only). An invited canvasser lands on
 * /set-password with a session from the invite link (/auth/confirm) and
 * chooses their password here. Then they go to their home.
 */
export async function setPassword(formData: FormData) {
  const password = String(formData.get("password") ?? "");
  if (password.length < 8) {
    redirect("/set-password?error=short");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?error=link");
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    redirect(error.code === "weak_password" ? "/set-password?error=weak" : "/set-password?error=failed");
  }

  const profile = await getOwnProfile(supabase, user.id);
  if (!profile || !profile.active) {
    redirect("/account-pending");
  }

  redirect(homeForRole(profile.role));
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
