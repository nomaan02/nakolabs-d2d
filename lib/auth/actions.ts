"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getOwnProfile } from "@/lib/auth/profile";
import { homeForRole } from "@/lib/auth/roles";

function readString(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function signIn(formData: FormData) {
  const email = readString(formData, "email");
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

export async function signUp(formData: FormData) {
  const fullName = readString(formData, "full_name");
  const email = readString(formData, "email");
  const password = String(formData.get("password") ?? "");

  if (!fullName || !email || !password) {
    redirect("/signup?error=invalid");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });

  if (error) {
    const already =
      error.code === "user_already_exists" ||
      error.message.toLowerCase().includes("already registered");
    if (already) redirect("/signup?error=exists");
    if (error.code === "email_address_invalid") {
      redirect("/signup?error=email");
    }
    redirect("/signup?error=failed");
  }

  if (!data.session) {
    // Email confirmation is on: the trigger still created the profile, but
    // there is no session yet. Do not send them into a protected route.
    redirect("/login?notice=created");
  }

  const profile = data.user
    ? await getOwnProfile(supabase, data.user.id)
    : null;

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
