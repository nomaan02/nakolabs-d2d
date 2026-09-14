/**
 * Copies MapLibre's worker chunk into `public/maplibre/`.
 *
 * MapLibre works out its own worker URL from `import.meta.url`, and bails to an
 * empty string when that is not an http(s) URL. Under Turbopack it is not, so
 * the map ends up doing `new Worker("")`, the worker never boots, no vector
 * tile is ever parsed and the map stays blank forever without an error. We
 * serve the chunk from `public/` instead and point MapLibre at it with
 * `setWorkerUrl` (see `components/admin/prop-drawer.tsx`).
 *
 * The worker is an ES module that imports `./maplibre-gl-shared.mjs`, so both
 * files have to land in the same directory. Copied on every dev/build run
 * rather than committed, so it can never drift from the installed version.
 */
import { copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

const FILES = ["maplibre-gl-worker.mjs", "maplibre-gl-shared.mjs"];

async function main() {
  const from = join(process.cwd(), "node_modules", "maplibre-gl", "dist");
  const to = join(process.cwd(), "public", "maplibre");

  await mkdir(to, { recursive: true });
  for (const file of FILES) {
    await copyFile(join(from, file), join(to, file));
  }
  console.log(`maplibre worker → public/maplibre (${FILES.join(", ")})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
