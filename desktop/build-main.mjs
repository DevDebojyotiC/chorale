// Build the Electron main + preload with esbuild. They bundle our own TS (desktop/ + src/ core) but
// keep every npm dependency external — Electron's Node loads them from node_modules at runtime, and
// native modules (better-sqlite3) can't be bundled anyway.
import { build } from "esbuild";

const common = {
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  packages: "external", // all node_modules stay external; only our source is bundled
  sourcemap: true,
  logLevel: "info",
};

await build({ ...common, entryPoints: ["desktop/main.ts"], outfile: "desktop/dist/main.cjs", external: ["electron"] });
await build({ ...common, entryPoints: ["desktop/preload.ts"], outfile: "desktop/dist/preload.cjs", external: ["electron"] });
