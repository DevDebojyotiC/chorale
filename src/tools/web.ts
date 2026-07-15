import { tool } from "ai";
import { z } from "zod";

const UA = "Mozilla/5.0 (compatible; ChoraleBot/0.1)";
const FETCH_TIMEOUT_MS = 15000;

/** Cap tool output aggressively — small local models have tiny context budgets. */
const FETCH_MAX_CHARS = 2500;
/** Per-source excerpt when reading several pages at once in web_research. */
const RESEARCH_READ_CHARS = 1500;

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface Source {
  title: string;
  url: string;
  content: string;
}

const SEARCH_UNAVAILABLE_NOTE =
  "Reliable web search is unavailable: no TAVILY_API_KEY is set and the free DuckDuckGo endpoint is currently blocking automated requests. " +
  "Add a free Tavily API key (https://tavily.com) to .env to enable research. " +
  "Do NOT fabricate an answer — tell the user that web search is unavailable.";

/** Tavily: an AI-oriented search API that returns extracted page CONTENT, not just links. */
async function tavilySearch(query: string, maxResults: number, apiKey: string): Promise<Source[]> {
  const res = await fetchResilient("https://api.tavily.com/search", FETCH_TIMEOUT_MS, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query, max_results: maxResults, search_depth: "basic" }),
  });
  if (!res.ok) throw new Error(`Tavily HTTP ${res.status}`);
  const json = (await res.json()) as {
    results?: Array<{ title?: string; url?: string; content?: string }>;
  };
  return (json.results ?? []).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    content: r.content ?? "",
  }));
}

async function fetchWithTimeout(url: string, ms: number, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { "User-Agent": UA, ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}

const wsleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** fetchWithTimeout + retry-with-backoff on transient failures (429 / 5xx / network). */
async function fetchResilient(url: string, ms: number, init?: RequestInit, retries = 2): Promise<Response> {
  let last: unknown;
  for (let n = 0; ; n++) {
    try {
      const res = await fetchWithTimeout(url, ms, init);
      if ((res.status === 429 || (res.status >= 500 && res.status < 600)) && n < retries) {
        await wsleep(Math.min(4000, 400 * 2 ** n) + Math.floor(Math.random() * 200));
        continue;
      }
      return res;
    } catch (e) {
      last = e;
      if (n < retries) { await wsleep(Math.min(4000, 400 * 2 ** n)); continue; }
      throw last;
    }
  }
}

/** Very small, dependency-free HTML → text. Good enough for research snippets. */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** DuckDuckGo wraps outbound links as /l/?uddg=<encoded>. Unwrap to the real URL. */
function decodeDdgHref(href: string): string {
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m?.[1]) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* fall through */
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}

/** Core web search via the DuckDuckGo HTML endpoint (no API key). */
async function ddgSearch(query: string, limit: number): Promise<SearchResult[]> {
  const res = await fetchResilient(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    FETCH_TIMEOUT_MS,
  );
  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status} (search endpoint is blocking automated requests)`);
  const html = await res.text();

  const snippets: string[] = [];
  const snippetRe = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let sm: RegExpExecArray | null;
  while ((sm = snippetRe.exec(html)) !== null) snippets.push(htmlToText(sm[1] ?? ""));

  const results: SearchResult[] = [];
  const anchorRe = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let am: RegExpExecArray | null;
  let i = 0;
  while ((am = anchorRe.exec(html)) !== null && results.length < limit) {
    results.push({
      title: htmlToText(am[2] ?? ""),
      url: decodeDdgHref(am[1] ?? ""),
      snippet: snippets[i] ?? "",
    });
    i++;
  }
  return results;
}

type FetchResult = { url: string; text: string; truncated: boolean } | { url: string; error: string };

/** Fetch a URL and extract text, truncated to maxChars. Never throws. */
async function fetchAndExtract(url: string, maxChars: number): Promise<FetchResult> {
  try {
    const res = await fetchResilient(url, FETCH_TIMEOUT_MS);
    if (!res.ok) return { url, error: `HTTP ${res.status}` };
    const contentType = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = contentType.includes("html") ? htmlToText(body) : body;
    return { url, text: text.slice(0, maxChars), truncated: text.length > maxChars };
  } catch (e) {
    return { url, error: e instanceof Error ? e.message : String(e) };
  }
}

export const webSearch = tool({
  description:
    "Search the web and return the top results (title, url, snippet) WITHOUT reading them. Prefer web_research when you need the actual page contents.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    max_results: z.number().int().min(1).max(10).optional().describe("How many results (default 5)"),
  }),
  execute: async ({ query, max_results }) => {
    const limit = max_results ?? 5;
    const tavilyKey = process.env.TAVILY_API_KEY;
    try {
      if (tavilyKey) {
        const sources = await tavilySearch(query, limit, tavilyKey);
        return {
          query,
          results: sources.map((s) => ({ title: s.title, url: s.url, snippet: s.content.slice(0, 240) })),
        };
      }
      const results = await ddgSearch(query, limit);
      if (results.length === 0) return { query, results: [], note: SEARCH_UNAVAILABLE_NOTE };
      return { query, results };
    } catch (e) {
      const base = `Search failed: ${e instanceof Error ? e.message : String(e)}`;
      return { error: tavilyKey ? base : `${base} — ${SEARCH_UNAVAILABLE_NOTE}` };
    }
  },
});

export const webFetch = tool({
  description:
    "Fetch a single web page by URL and return its main text content (truncated). Use to read a specific URL.",
  inputSchema: z.object({
    url: z.string().describe("The absolute URL to fetch, including https://"),
  }),
  execute: async ({ url }) => fetchAndExtract(url, FETCH_MAX_CHARS),
});

export const webResearch = tool({
  description:
    "Search the web AND read the top results in one step. Returns actual page content to ground your answer in. Prefer this for research questions — one call gives you sources you can cite.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
    max_results: z.number().int().min(1).max(8).optional().describe("Total results to list (default 5)"),
    read_top: z.number().int().min(1).max(4).optional().describe("How many top results to actually read (default 2)"),
  }),
  execute: async ({ query, max_results, read_top }) => {
    const limit = max_results ?? 5;
    const toReadN = read_top ?? 2;
    const tavilyKey = process.env.TAVILY_API_KEY;
    try {
      // Preferred path: Tavily returns extracted content directly — no scraping/fetching needed.
      if (tavilyKey) {
        const sources = await tavilySearch(query, limit, tavilyKey);
        if (sources.length === 0) return { query, read: [], other_results: [], note: "No results found." };
        const toRead = Math.min(toReadN, sources.length);
        return {
          query,
          read: sources.slice(0, toRead).map((s) => ({ title: s.title, url: s.url, content: s.content })),
          other_results: sources.slice(toRead).map((s) => ({ title: s.title, url: s.url, snippet: s.content.slice(0, 200) })),
        };
      }

      // Fallback path: scrape DuckDuckGo + fetch pages ourselves (brittle; may be blocked).
      const results = await ddgSearch(query, limit);
      if (results.length === 0) return { query, read: [], other_results: [], note: SEARCH_UNAVAILABLE_NOTE };
      const toRead = Math.min(toReadN, results.length);
      const read = await Promise.all(
        results.slice(0, toRead).map(async (r) => {
          const ex = await fetchAndExtract(r.url, RESEARCH_READ_CHARS);
          return { title: r.title, url: r.url, content: "text" in ex ? ex.text : `(could not read: ${ex.error})` };
        }),
      );
      const other = results.slice(toRead).map(({ title, url, snippet }) => ({ title, url, snippet }));
      return { query, read, other_results: other };
    } catch (e) {
      const base = `Research failed: ${e instanceof Error ? e.message : String(e)}`;
      return { error: tavilyKey ? base : `${base} — ${SEARCH_UNAVAILABLE_NOTE}` };
    }
  },
});
