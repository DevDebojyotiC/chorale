/**
 * Topic-aware document length. Different document types have very different natural
 * lengths — an invoice is ~1 page, a research paper/thesis is 10+ — so scribe sizes the
 * content it authors to a sensible per-topic default. A caller (or the user, in plain
 * language) can override the target; an explicit page count always wins over the default.
 *
 * This governs how much content the model *writes*, not the paper size (always A4).
 */

export interface PageTarget {
  /** Sensible default number of pages for this topic. */
  default: number;
  /** Soft lower/upper bounds for the topic (a document outside these is likely wrong-sized). */
  min: number;
  max: number;
  /** Human note on why, shown to the model. */
  note: string;
}

/**
 * Meaningful defaults per topic/profile (plus the core themes and a generic fallback).
 * Keyed by the same names as the design profiles so a topic maps straight to a length.
 */
export const PAGE_TARGETS: Record<string, PageTarget> = {
  invoice: { default: 1, min: 1, max: 3, note: "one page; an itemized statement with a work log may run 2–3" },
  resume: { default: 2, min: 1, max: 3, note: "1 page early-career, 2 standard, 3 for a senior/academic CV" },
  recipe: { default: 2, min: 1, max: 4, note: "a recipe card is 1–2; a full method with variations runs longer" },
  marketing: { default: 2, min: 1, max: 5, note: "a landing page / one-pager; a full campaign brief is longer" },
  clinical: { default: 3, min: 3, max: 6, note: "a lab/medical report is typically 3–4 pages" },
  executive: { default: 3, min: 2, max: 8, note: "a brief is 2–4; a full strategy review runs longer" },
  editorial: { default: 4, min: 2, max: 10, note: "a feature article is 2–6; a long read more" },
  techdoc: { default: 5, min: 2, max: 25, note: "API reference / guide — scales with the surface documented" },
  legal: { default: 6, min: 2, max: 40, note: "a short agreement is 2–4; a full contract 8–20+" },
  academic: { default: 12, min: 8, max: 80, note: "a paper is 8–15; a thesis/dissertation is 40+" },
  report: { default: 4, min: 2, max: 15, note: "an analytics/report document" },
  docs: { default: 4, min: 1, max: 25, note: "general documentation" },
  minimal: { default: 2, min: 1, max: 20, note: "plain document" },
  default: { default: 3, min: 1, max: 15, note: "general document" },
};

export interface ResolvedPages {
  /** The page count to author toward. */
  target: number;
  min: number;
  max: number;
  /** Where the target came from — a user-supplied count, or the topic default. */
  source: "user" | "default";
  note: string;
}

/**
 * Resolve the page target for a topic. An explicit `requested` count (from the user or a
 * caller) overrides the topic default; otherwise the topic's meaningful default is used.
 */
export function resolvePageTarget(topic: string, requested?: number | null): ResolvedPages {
  const base = PAGE_TARGETS[topic] ?? PAGE_TARGETS.default!;
  if (typeof requested === "number" && Number.isFinite(requested) && requested >= 1) {
    const t = Math.round(requested);
    return { target: t, min: t, max: t, source: "user", note: `user-specified ${t} page${t === 1 ? "" : "s"}` };
  }
  return { target: base.default, min: base.min, max: base.max, source: "default", note: base.note };
}

const NUM_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50,
};

/**
 * Extract an explicit page count from a natural-language instruction, e.g. "make it 5 pages",
 * "a two-page brief", "10-page report". Returns null when the user didn't specify a length.
 */
export function parsePageRequest(text: string): number | null {
  const s = text.toLowerCase();
  // "<n> page(s)" / "<n>-page" / "<word>-page"
  const m = s.match(/\b(\d{1,3}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)[\s-]?pages?\b/);
  if (m) {
    const tok = m[1]!;
    const n = NUM_WORDS[tok] ?? parseInt(tok, 10);
    return Number.isFinite(n) && n >= 1 ? n : null;
  }
  return null;
}
