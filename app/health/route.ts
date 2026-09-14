import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const ENV_VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_MAPTILER_KEY",
] as const;

type CheckStatus = "green" | "red";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, CheckStatus> = {};

  for (const name of ENV_VARS) {
    checks[name] = process.env[name] ? "green" : "red";
  }

  checks.supabase = await pingSupabase();

  const ok = Object.values(checks).every((status) => status === "green");

  return NextResponse.json(
    { ok, checks },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
}

async function pingSupabase(): Promise<CheckStatus> {
  try {
    const supabase = await createClient();
    const { error } = await supabase.from("profiles").select("id").limit(1);

    // Reachability, not data. Anon has no grant on profiles (42501). A
    // missing-table cache miss (PGRST205) is the Stage 0 signal.
    if (!error) return "green";
    if (error.code === "PGRST205" || error.code === "42501") return "green";
    return "red";
  } catch {
    return "red";
  }
}
