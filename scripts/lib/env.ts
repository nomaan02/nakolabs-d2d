import { readFileSync } from "node:fs";
import path from "node:path";

/** Load repo-root `.env.local` into `process.env` without overriding existing values. */
export function loadEnvLocal(root = process.cwd()): void {
  const file = path.resolve(root, ".env.local");
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    throw new Error(`Missing ${file}`);
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing environment variable ${name}`);
  }
  return value;
}
