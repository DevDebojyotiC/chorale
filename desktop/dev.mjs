// Dev launcher — Vite HMR for the renderer + a rebuilt-and-relaunched Electron main. No extra deps:
// uses Vite's JS API, esbuild for main/preload, and the electron binary path the `electron` pkg exports.
import { spawn } from "node:child_process";
import { createServer } from "vite";
import electronPath from "electron";
import "./build-main.mjs"; // builds desktop/dist/{main,preload}.cjs (top-level await inside)

const server = await createServer({ configFile: "desktop/vite.config.ts" });
await server.listen();
const url = server.resolvedUrls?.local?.[0] ?? "http://localhost:5173";
process.stdout.write(`\n[chorale-ui] renderer on ${url} — launching Electron…\n`);

const child = spawn(electronPath, ["desktop/dist/main.cjs"], {
  stdio: "inherit",
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on("exit", async () => {
  await server.close();
  process.exit(0);
});
