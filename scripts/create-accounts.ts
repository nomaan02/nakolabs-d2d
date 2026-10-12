/**
 * CRM-5 U (owner 2026-10-12). Creates username accounts for canvassers and
 * links each one to their CRM first name, so the field app can show their
 * own CRM leads and call-back list.
 *
 *   npm run accounts:create -- --branch "HO Bristol" --user thomas:Thomas:canvasser --link you@example.com:Nomaan
 *       dry run: checks everything, writes NOTHING
 *   npm run accounts:create -- --write --branch "HO Bristol" --user ...
 *       real run
 *
 *   --user  <username>:<CRM name>:<role>   new account, signs in with the username.
 *           role = canvasser | admin | office. A temporary password is made up
 *           and printed ONCE, on this screen only. Hand it over in person.
 *           If the username already has an account, its password is left alone
 *           and only its CRM name is set.
 *   --link  <email>:<CRM name>             an existing account (found by email):
 *           sets its CRM name only. Role and password are not touched.
 *   --branch <CRM branch>                   CRM branch for every name (e.g. "HO Bristol").
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local.
 * Never sends an email: username accounts use a reserved domain that can't
 * receive mail (lib/auth/username.ts).
 */
import { randomInt } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { isValidUsername, USERNAME_DOMAIN } from "../lib/auth/username";
import { createIngestClient } from "./lib/supabase";

const ROLES = ["canvasser", "admin", "office"] as const;
type Role = (typeof ROLES)[number];

type NewAccount = { kind: "user"; username: string; email: string; crmName: string; role: Role };
type Link = { kind: "link"; email: string; crmName: string };
type Plan = { write: boolean; branch: string | null; accounts: (NewAccount | Link)[] };

const CRM_NAME = /^[A-Za-z][A-Za-z' -]{0,39}$/;

export function parseArgs(argv: readonly string[]): Plan {
  const plan: Plan = { write: argv.includes("--write"), branch: null, accounts: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (flag !== "--user" && flag !== "--link" && flag !== "--branch") continue;
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    i += 1;
    if (flag === "--branch") {
      plan.branch = value.trim() || null;
      continue;
    }
    const parts = value.split(":").map((p) => p.trim());
    if (flag === "--user") {
      const [username = "", crmName = "", role = ""] = parts;
      const name = username.toLowerCase();
      if (parts.length !== 3) throw new Error(`--user ${value}: use username:CRM name:role`);
      if (!isValidUsername(name)) throw new Error(`--user ${value}: username must be 2-31 characters, a letter first, then letters, digits, . _ or -`);
      if (!CRM_NAME.test(crmName)) throw new Error(`--user ${value}: CRM name looks wrong`);
      if (!ROLES.includes(role as Role)) throw new Error(`--user ${value}: role must be canvasser, admin or office`);
      plan.accounts.push({ kind: "user", username: name, email: `${name}@${USERNAME_DOMAIN}`, crmName, role: role as Role });
    } else {
      const [email = "", crmName = ""] = parts;
      if (parts.length !== 2 || !email.includes("@")) throw new Error(`--link ${value}: use email:CRM name`);
      if (!CRM_NAME.test(crmName)) throw new Error(`--link ${value}: CRM name looks wrong`);
      plan.accounts.push({ kind: "link", email: email.toLowerCase(), crmName });
    }
  }
  const emails = plan.accounts.map((a) => a.email);
  if (new Set(emails).size !== emails.length) throw new Error("The same account is listed twice.");
  const names = plan.accounts.map((a) => a.crmName.toLowerCase());
  if (new Set(names).size !== names.length) throw new Error("The same CRM name is listed twice.");
  return plan;
}

/** 12 characters from an alphabet with no look-alikes (no 0/O, 1/l/I). */
export function temporaryPassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 12; i += 1) out += alphabet[randomInt(alphabet.length)];
  return out;
}

async function allUsers(db: SupabaseClient): Promise<Map<string, User>> {
  const byEmail = new Map<string, User>();
  for (let page = 1; page < 50; page += 1) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`Could not list accounts: ${error.message}`);
    for (const u of data.users) if (u.email) byEmail.set(u.email.toLowerCase(), u);
    if (data.users.length < 200) break;
  }
  return byEmail;
}

async function crmLeadCount(db: SupabaseClient, crmName: string, branch: string | null): Promise<number> {
  let q = db.from("crm_leads").select("crm_id", { count: "exact", head: true }).eq("canvasser_first_name", crmName);
  if (branch) q = q.eq("branch", branch);
  const { count, error } = await q;
  if (error) throw new Error(`Could not count CRM leads: ${error.message}`);
  return count ?? 0;
}

async function setProfile(db: SupabaseClient, id: string, fields: Record<string, string | null>): Promise<void> {
  const { data, error } = await db.from("profiles").update(fields).eq("id", id).select("id");
  if (error) throw new Error(`Could not update the account: ${error.message}`);
  if (!data || data.length !== 1) throw new Error("The account has no profile row.");
}

async function main(): Promise<void> {
  const plan = parseArgs(process.argv.slice(2));
  if (plan.accounts.length === 0) throw new Error("Nothing to do. Add --user or --link.");
  const db = createIngestClient();
  console.log(plan.write ? "== Accounts: REAL RUN ==" : "== Accounts: DRY RUN (writes nothing) ==");
  console.log(`CRM branch: ${plan.branch ?? "any"}\n`);

  const users = await allUsers(db);
  let problems = 0;
  for (const a of plan.accounts) {
    const leads = await crmLeadCount(db, a.crmName, plan.branch);
    const existing = users.get(a.email);
    const who = a.kind === "user" ? a.username.padEnd(14) : "(existing)".padEnd(14);
    let action: string;
    if (a.kind === "link") {
      action = existing ? "link CRM name" : "NOT FOUND: no account with that email";
      if (!existing) problems += 1;
    } else {
      action = existing ? "already exists: link CRM name only (password unchanged)" : `create (${a.role})`;
    }
    if (leads === 0) problems += 1;
    console.log(`  ${who} CRM "${a.crmName}"  ${String(leads).padStart(5)} CRM leads${leads === 0 ? "  <- NONE: check the spelling" : ""}  ${action}`);
  }
  if (problems > 0) {
    console.log(`\n${problems} problem(s) above. Nothing written. Fix them and run again.`);
    process.exit(1);
  }
  if (!plan.write) {
    console.log("\nDry run finished. Nothing was written. Add --write to do it.");
    return;
  }

  const handOver: { username: string; password: string }[] = [];
  for (const a of plan.accounts) {
    let id = users.get(a.email)?.id;
    if (!id && a.kind === "user") {
      const password = temporaryPassword();
      const { data, error } = await db.auth.admin.createUser({
        email: a.email,
        password,
        email_confirm: true,
        user_metadata: { full_name: a.crmName },
      });
      if (error || !data.user) throw new Error(`Could not create ${a.username}: ${error?.message ?? "no user returned"}. Stopped; accounts above this one are done.`);
      id = data.user.id;
      handOver.push({ username: a.username, password });
    }
    if (!id) throw new Error(`No account for ${a.email}.`);
    const fields: Record<string, string | null> = { crm_name: a.crmName, crm_branch: plan.branch };
    if (a.kind === "user" && !users.has(a.email)) fields.role = a.role;
    await setProfile(db, id, fields);
    console.log(`  done: ${a.kind === "user" ? a.username : "(existing account)"} -> ${a.crmName}`);
  }

  if (handOver.length > 0) {
    console.log("\nTemporary passwords. Shown ONCE. Write them down and hand them over in person:");
    for (const h of handOver) console.log(`  ${h.username.padEnd(14)} ${h.password}`);
    console.log("\nThey sign in at the app with the username and this password.");
  }
}

if (process.argv[1]?.endsWith("create-accounts.ts")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
