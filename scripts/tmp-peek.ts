import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal, requiredEnv } from "./lib/env";
import type { Database } from "../lib/supabase/types";

loadEnvLocal();
const service = createClient<Database>(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

const ids = process.argv.slice(2);

async function main() {
const knocks = await service
  .from("knock_events")
  .select("client_event_id, uprn, outcome, notes, occurred_at")
  .order("occurred_at");
const leads = await service.from("leads").select("client_event_id, uprn, booked_for, is_immediate");
const obs = await service.from("property_observations").select("client_event_id, uprn, tenure");
const addr = await service
  .from("address_observations")
  .select("client_event_id, uprn, house_number");

console.log("knock_events   ", knocks.data?.length, JSON.stringify(knocks.data));
console.log("leads          ", leads.data?.length, JSON.stringify(leads.data));
console.log("observations   ", obs.data?.length, JSON.stringify(obs.data));
console.log("addresses      ", addr.data?.length, JSON.stringify(addr.data));
for (const id of ids) {
  console.log(`  ${id} → knocks=${knocks.data?.filter((r) => r.client_event_id === id).length}`);
}
}
void main();
