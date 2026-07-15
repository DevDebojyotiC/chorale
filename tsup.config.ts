import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/tui/app.tsx"],
  format: ["esm"],
  target: "node22",
  outDir: "dist",
  clean: true,
  sourcemap: true,
  dts: false,
  shims: false,
});
