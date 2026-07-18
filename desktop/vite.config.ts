import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

// Renderer-only Vite config. The Electron main + preload are built separately (esbuild, build-main.mjs).
export default defineConfig({
  root: resolve(__dirname, "renderer"),
  base: "./", // relative asset paths so file:// loading works in the packaged app
  plugins: [react()],
  server: { port: 5173, strictPort: true, fs: { allow: [resolve(__dirname)] } },
  build: {
    outDir: resolve(__dirname, "dist/renderer"),
    emptyOutDir: true,
    target: "chrome122", // Electron ships a known Chromium — no need to down-level
  },
});
