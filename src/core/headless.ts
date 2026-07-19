/**
 * Headless-browser rendering via the system Chrome/Edge (no bundled Chromium, no extra dependency).
 * Two consumers: the coder's verify loop (does a static page actually render when opened?) and the
 * research agent (read JS-rendered pages that plain fetch/Tavily can't). Uses `--dump-dom`, which runs
 * the page's JS and prints the resulting DOM — so a page that renders blank comes back empty.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAbsolute } from "node:path";

/** Locate a Chromium-based browser (Chrome/Edge/Chromium), or null. Override with CHORALE_CHROME. */
export function findBrowser(): string | null {
  if (process.env.CHORALE_CHROME && existsSync(process.env.CHORALE_CHROME)) return process.env.CHORALE_CHROME;
  const candidates =
    process.platform === "win32"
      ? [
          "C:/Program Files/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
          "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
          "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"];
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Strip a rendered HTML document to its visible text (scripts/styles removed, entities decoded). */
export function htmlToText(html: string): string {
  const body = html.match(/<body[\s\S]*?<\/body>/i)?.[0] ?? html;
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export interface RenderResult {
  /** True when a browser was found and ran (even if the page itself rendered blank). */
  ok: boolean;
  /** The post-JS DOM (empty when no browser / a hard failure). */
  html: string;
  /** Visible text extracted from the rendered body. */
  text: string;
  /** Number of elements in the rendered document (a blank/failed page has very few). */
  elements: number;
  error?: string;
}

/** Whether a headless render is even possible on this machine. */
export const headlessAvailable = (): boolean => findBrowser() !== null;

/**
 * Render a URL or local file with the system headless browser and return the DOM AFTER its JS runs.
 * `target` may be an http(s) URL, a file:// URL, or a local absolute path (converted to file://).
 */
export function renderDom(target: string, opts: { timeoutMs?: number; virtualTimeMs?: number } = {}): RenderResult {
  const browser = findBrowser();
  if (!browser) return { ok: false, html: "", text: "", elements: 0, error: "No Chromium-based browser found (install Chrome/Edge, or set CHORALE_CHROME)." };
  const url = /^(https?|file):/.test(target) ? target : isAbsolute(target) ? pathToFileURL(target).href : target;
  const r = spawnSync(
    browser,
    // NOTE: no --allow-file-access-from-files — we want the render to reflect exactly what a user sees
    // when they double-click the file, so file://-blocked ES modules stay broken (that's the point).
    ["--headless", "--disable-gpu", "--no-sandbox", "--dump-dom", `--virtual-time-budget=${opts.virtualTimeMs ?? 3000}`, url],
    { timeout: opts.timeoutMs ?? 30000, maxBuffer: 48 * 1024 * 1024, encoding: "utf8" },
  );
  if (r.error) return { ok: false, html: "", text: "", elements: 0, error: r.error.message };
  const html = r.stdout ?? "";
  const elements = (html.match(/<[a-zA-Z][^>]*>/g) ?? []).length;
  return { ok: true, html, text: htmlToText(html), elements };
}
