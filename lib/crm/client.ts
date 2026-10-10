/**
 * CRM-1 B. The ONLY caller of the company CRM (LeadGen = white-labelled vtiger 8).
 *
 * READ-ONLY BY CONSTRUCTION (AGENTS "CRM data", owner 2026-10-10):
 *   - only the operations in CRM_READ_OPERATIONS can be sent;
 *   - `query` must be a single SELECT ... FROM Leads statement;
 *   - server-only: the access key never reaches a browser bundle.
 * `npm run verify:crm` fails if this file ever names a write operation.
 */
import { createHash } from "node:crypto";

export const CRM_READ_OPERATIONS = ["getchallenge", "login", "listtypes", "describe", "query", "logout"] as const;
export type CrmReadOperation = (typeof CRM_READ_OPERATIONS)[number];

export const CRM_DEFAULT_BASE_URL = "https://crm.lead-gen.cloud";
export const CRM_PAGE_SIZE = 100;

export class CrmError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Throws unless the call is a permitted read. Exported for verify:crm. */
export function assertReadOnlyCall(operation: string, query?: string): asserts operation is CrmReadOperation {
  if (!(CRM_READ_OPERATIONS as readonly string[]).includes(operation)) {
    throw new CrmError(`Blocked CRM operation "${operation}": this app only reads from the CRM.`, "BLOCKED_OPERATION");
  }
  if (operation !== "query") return;
  const sql = (query ?? "").trim();
  const single = sql.endsWith(";") && !sql.slice(0, -1).includes(";");
  if (!single || !/^SELECT\s[\s\S]+\sFROM\s+Leads\b/i.test(sql)) {
    throw new CrmError("Blocked CRM query: only one SELECT ... FROM Leads statement is allowed.", "BLOCKED_QUERY");
  }
}

type CrmEnvelope<T> = { success: boolean; result?: T; error?: { code?: string; message?: string } };

export type CrmReader = {
  query<T>(sql: string): Promise<T[]>;
  close(): Promise<void>;
};

export type OpenCrmOptions = {
  user: string;
  accessKey: string;
  baseUrl?: string;
  /** Minimum gap between requests; 1,000 ms for the backfill (owner: gentle on their server). */
  minIntervalMs?: number;
};

export async function openCrmReader(options: OpenCrmOptions): Promise<CrmReader> {
  if (typeof window !== "undefined") throw new CrmError("The CRM client is server-only.", "SERVER_ONLY");
  if (!options.user || !options.accessKey) throw new CrmError("CRM_USER and CRM_API_KEY must be set.", "NO_CREDENTIALS");

  const endpoint = `${(options.baseUrl ?? CRM_DEFAULT_BASE_URL).replace(/\/+$/, "")}/webservice.php`;
  const gap = options.minIntervalMs ?? 1000;
  let lastCall = 0;
  let session = "";

  const call = async <T>(method: "GET" | "POST", params: Record<string, string>): Promise<T> => {
    assertReadOnlyCall(params.operation ?? "", params.query);
    const wait = lastCall + gap - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCall = Date.now();

    const body = new URLSearchParams(params);
    const response =
      method === "GET"
        ? await fetch(`${endpoint}?${body.toString()}`, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(30_000) })
        : await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body,
            cache: "no-store",
            signal: AbortSignal.timeout(30_000),
          });
    if (!response.ok) throw new CrmError(`CRM HTTP ${response.status}`, `HTTP_${response.status}`);
    const json = (await response.json()) as CrmEnvelope<T>;
    if (!json.success || json.result === undefined) {
      throw new CrmError(`CRM refused: ${json.error?.message ?? "unknown error"}`, json.error?.code ?? "UNKNOWN");
    }
    return json.result;
  };

  const login = async () => {
    const challenge = await call<{ token: string }>("GET", { operation: "getchallenge", username: options.user });
    const accessKey = createHash("md5").update(challenge.token + options.accessKey).digest("hex");
    const result = await call<{ sessionName: string }>("POST", { operation: "login", username: options.user, accessKey });
    session = result.sessionName;
  };

  await login();

  return {
    async query<T>(sql: string): Promise<T[]> {
      try {
        return await call<T[]>("GET", { operation: "query", sessionName: session, query: sql });
      } catch (err) {
        if (err instanceof CrmError && err.code === "INVALID_SESSIONID") {
          await login();
          return call<T[]>("GET", { operation: "query", sessionName: session, query: sql });
        }
        throw err;
      }
    },
    async close() {
      try {
        await call<unknown>("POST", { operation: "logout", sessionName: session });
      } catch {
        // Logout is refused by this CRM; the session expires on its own (probe 2026-10-10).
      }
    },
  };
}
