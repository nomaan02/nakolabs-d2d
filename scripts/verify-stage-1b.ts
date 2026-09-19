/**
 * Stage 1b RLS check — road_nodes / road_segments as reference data.
 *
 * Real authenticated JWT and the anon key, not postgres or service_role.
 * Service role is used only to create/delete the throwaway user.
 *
 *   npx tsx scripts/verify-stage-1b.ts
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";

loadEnvLocal();
const URL_ = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
const ANON = requiredEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SERVICE = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
const PASSWORD = "stage1b-harness-pw-8f21";
const EMAIL_PREFIX = "stage1b-";

type Client = SupabaseClient;

const service: Client = createClient(URL_, SERVICE, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failures = 0;

function check(label: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
}

async function cleanup(): Promise<void> {
  const { data, error } = await service.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(error.message);
  const ours = data.users.filter((u) => u.email?.startsWith(EMAIL_PREFIX));
  for (const user of ours) {
    const { error: delError } = await service.auth.admin.deleteUser(user.id);
    if (delError) throw new Error(`deleteUser ${user.email}: ${delError.message}`);
  }
  console.log(`cleanup: removed ${ours.length} harness user(s)`);
}

async function countAs(
  client: Client,
  table: "road_nodes" | "road_segments",
): Promise<{ count: number | null; message: string | null; code: string | null }> {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true });
  return {
    count: count ?? null,
    message: error?.message ?? null,
    code: error?.code ?? null,
  };
}

async function main(): Promise<void> {
  await cleanup();

  const email = `${EMAIL_PREFIX}canvasser-${Date.now().toString(36)}@nakolabs-test.com`;
  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: "Stage 1b canvasser" },
  });
  if (createError || !created.user) {
    throw new Error(`createUser: ${createError?.message}`);
  }

  const auth = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: session, error: signInError } = await auth.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  if (signInError || !session.session) {
    throw new Error(`signIn: ${signInError?.message}`);
  }

  const canvasser = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
  const anon = createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const serviceNodes = await countAs(service, "road_nodes");
  const serviceSegs = await countAs(service, "road_segments");
  const authNodes = await countAs(canvasser, "road_nodes");
  const authSegs = await countAs(canvasser, "road_segments");
  const anonNodes = await countAs(anon, "road_nodes");
  const anonSegs = await countAs(anon, "road_segments");

  check(
    "authenticated JWT reads road_nodes",
    authNodes.count === serviceNodes.count && (authNodes.count ?? 0) > 0,
    `auth=${authNodes.count} service=${serviceNodes.count} err=${authNodes.message ?? "none"}`,
  );
  check(
    "authenticated JWT reads road_segments",
    authSegs.count === serviceSegs.count && (authSegs.count ?? 0) > 0,
    `auth=${authSegs.count} service=${serviceSegs.count} err=${authSegs.message ?? "none"}`,
  );
  check(
    "anon cannot read road_nodes",
    anonNodes.count === 0 || anonNodes.message !== null,
    `count=${anonNodes.count} code=${anonNodes.code ?? "none"} msg=${anonNodes.message ?? "none"}`,
  );
  check(
    "anon cannot read road_segments",
    anonSegs.count === 0 || anonSegs.message !== null,
    `count=${anonSegs.count} code=${anonSegs.code ?? "none"} msg=${anonSegs.message ?? "none"}`,
  );

  const { error: insertNodeError } = await canvasser.from("road_nodes").insert({
    id: -1,
    geom: null,
  });
  check(
    "authenticated JWT cannot insert road_nodes",
    insertNodeError !== null,
    insertNodeError?.message ?? "inserted",
  );

  const { error: insertSegError } = await canvasser.from("road_segments").insert({
    osm_way_id: -1,
    from_node: -1,
    to_node: -1,
    highway: "residential",
    length_m: 1,
    geom: null,
  });
  check(
    "authenticated JWT cannot insert road_segments",
    insertSegError !== null,
    insertSegError?.message ?? "inserted",
  );

  const { error: rpcError } = await canvasser.rpc("upsert_road_nodes", { p_rows: [] });
  check(
    "authenticated JWT cannot execute upsert_road_nodes",
    rpcError !== null,
    rpcError?.message ?? "executed",
  );

  await cleanup();

  if (failures > 0) {
    console.error(`\n${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("\nall RLS checks passed");
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
