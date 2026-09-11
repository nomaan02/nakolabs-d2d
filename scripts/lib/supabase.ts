import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./env";

export const BRISTOL_BBOX = {
  minLon: -2.72,
  maxLon: -2.45,
  minLat: 51.38,
  maxLat: 51.54,
} as const;

let cached: SupabaseClient | undefined;

/** Service-role client for ingest scripts only. Never imported from `app/`. */
export function createIngestClient(): SupabaseClient {
  if (cached) return cached;
  loadEnvLocal();
  cached = createClient(
    requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  return cached;
}

export async function rpc<T>(
  name: string,
  args: Record<string, unknown>,
): Promise<T> {
  const supabase = createIngestClient();
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    throw new Error(`${name} failed: ${error.message}`);
  }
  return data as T;
}

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= attempts; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const delay = 500 * 2 ** (i - 1);
      console.warn(`${label}: attempt ${i}/${attempts} failed; retrying in ${delay}ms`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
