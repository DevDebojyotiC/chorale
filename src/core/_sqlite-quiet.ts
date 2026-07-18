/**
 * Silence node:sqlite's one-time "experimental feature" warning. Imported for its side effect BEFORE
 * node:sqlite itself (see sqlite.ts) — ES module import order runs this first, so the filter is in place
 * when the built-in loads. Kept in its own module because a static `import { DatabaseSync }` can't be
 * preceded by a statement in the same file (imports hoist), and `createRequire(import.meta.url)` is not
 * valid in the esbuild-CJS bundle used for the Electron main.
 */
const orig = process.emitWarning.bind(process);
process.emitWarning = ((warning: string | Error, ...rest: unknown[]): void => {
  const msg = typeof warning === "string" ? warning : warning?.message;
  if (typeof msg === "string" && msg.includes("SQLite is an experimental feature")) return;
  (orig as (...a: unknown[]) => void)(warning, ...rest);
}) as typeof process.emitWarning;

export {};
