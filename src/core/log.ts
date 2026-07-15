import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { redactSecrets } from "./redact.js";

/**
 * Leveled logging with an optional persisted run transcript. Diagnostics go to
 * stderr (respecting the level); when a log file is set, EVERY message is also
 * appended there (regardless of level) as the run transcript for post-hoc debugging.
 * All output is secret-redacted.
 */
export type LogLevel = "error" | "warn" | "info" | "debug";
const ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

function isLevel(x: string | undefined): x is LogLevel {
  return x === "error" || x === "warn" || x === "info" || x === "debug";
}

let currentLevel: LogLevel = isLevel(process.env.CHORALE_LOG_LEVEL) ? process.env.CHORALE_LOG_LEVEL : "info";
let logFile: string | undefined = process.env.CHORALE_LOG_FILE || undefined;

export function setLogLevel(l: LogLevel): void {
  currentLevel = l;
}
export function setLogFile(path: string | undefined): void {
  logFile = path;
  if (path) {
    try { mkdirSync(dirname(path), { recursive: true }); } catch { /* ignore */ }
  }
}

function emit(level: LogLevel, msg: string): void {
  const clean = redactSecrets(msg);
  if (ORDER[level] <= ORDER[currentLevel]) process.stderr.write(clean);
  if (logFile) {
    try { appendFileSync(logFile, `[${new Date().toISOString()}] ${level.toUpperCase()} ${clean.replace(/^\n+/, "")}`); } catch { /* ignore */ }
  }
}

export const log = {
  error: (m: string): void => emit("error", m),
  warn: (m: string): void => emit("warn", m),
  info: (m: string): void => emit("info", m),
  debug: (m: string): void => emit("debug", m),
};
