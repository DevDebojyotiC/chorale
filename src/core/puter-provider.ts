/**
 * Puter GLM provider (free GLM via Puter's user-pays gateway).
 *
 * Puter exposes AI ONLY through the puter.js JS function `puter.ai.chat` — there is no OpenAI-compatible
 * HTTP endpoint to point a client at. But puter.ai.chat is itself OpenAI-Chat-shaped: it takes a
 * messages array with system/user/assistant/tool roles and an OpenAI `tools` schema, and returns
 * `message.content` + `message.tool_calls` in the OpenAI structure. So instead of hand-writing a whole
 * Vercel-AI-SDK model, we reuse the battle-tested `@ai-sdk/openai-compatible` model and swap its `fetch`:
 * this shim intercepts the `/chat/completions` request the SDK builds, routes it through
 * `puter.ai.chat`, and wraps the reply back into the OpenAI Chat Completions envelope the SDK expects.
 * The dummy base URL is never actually hit.
 *
 * Auth: a Puter API token (created at puter.com/dashboard) passed as the provider apiKey /
 * PUTER_AUTH_TOKEN. The token is billed against the user's own Puter account (Puter's "user-pays" free
 * tier) — fine for light use; a heavy automated build loop may be rate-limited, so treat it accordingly.
 */

// The CJS Node entry (browser globals shimmed) — import lazily so a missing/invalid token never breaks
// startup for runs that don't use the puter provider at all.
type PuterClient = { ai: { chat: (messages: unknown, testMode: boolean, opts: Record<string, unknown>) => Promise<PuterChatResponse> } };
type PuterChatResponse = { message?: { content?: unknown; tool_calls?: PuterToolCall[] }; usage?: { input_tokens?: number; output_tokens?: number; prompt_tokens?: number; completion_tokens?: number } };
type PuterToolCall = { id?: string; function?: { name?: string; arguments?: unknown } };

let cached: { token: string; client: PuterClient } | null = null;
let guardInstalled = false;

/**
 * puter.js opens a realtime WebSocket when it initializes in Node, and that socket crashes on close
 * inside undici with an uncaught "Maximum call stack size exceeded" — which takes down the whole
 * process on the first AI call. The chat request itself succeeds over HTTP; only the background socket
 * misbehaves. So install a tightly-scoped guard that swallows ONLY that noise (stack mentions the puter
 * vm sandbox / undici WebSocket) and preserves normal fatal behavior for every other error. Installed
 * once, lazily, and only when the puter provider is actually used — runs that never touch it are
 * unaffected.
 */
function installWsNoiseGuard(): void {
  if (guardInstalled) return;
  guardInstalled = true;
  const isPuterWsNoise = (e: unknown): boolean => {
    const s = e instanceof Error ? (e.stack ?? e.message) : String(e);
    return /evalmachine|undici|WebSocket/i.test(s);
  };
  process.on("uncaughtException", (e) => {
    if (isPuterWsNoise(e)) return; // puter's realtime socket — ignore
    console.error(e); // not ours: preserve the default fatal behavior
    process.exit(1);
  });
  process.on("unhandledRejection", (e) => {
    if (!isPuterWsNoise(e)) throw e instanceof Error ? e : new Error(String(e));
  });
}

async function puterClient(token: string): Promise<PuterClient> {
  if (cached && cached.token === token) return cached.client;
  installWsNoiseGuard();
  const mod = (await import("@heyputer/puter.js/src/init.cjs")) as unknown as { init: (t: string) => PuterClient };
  const client = mod.init(token);
  cached = { token, client };
  return client;
}

/** Extract a legible message from whatever puter.ai.chat rejects with (Error | plain object | string). */
function errText(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (e && typeof e === "object") {
    const o = e as { message?: unknown; error?: { message?: unknown } | string; code?: unknown; status?: unknown };
    const inner = typeof o.error === "object" ? o.error?.message : o.error;
    const msg = o.message ?? inner;
    if (typeof msg === "string" && msg) return o.code || o.status ? `${msg} (${o.code ?? o.status})` : msg;
    try {
      return JSON.stringify(o).slice(0, 300);
    } catch {
      return String(o);
    }
  }
  return String(e);
}

/** Coerce puter's message content (string | array of parts | object) to plain text. */
function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === "string" ? p : ((p as { text?: string })?.text ?? ""))).join("");
  if (content == null) return "";
  const t = (content as { text?: string }).text;
  return typeof t === "string" ? t : "";
}

/** Ensure a tool call matches the OpenAI shape the SDK parses (arguments must be a JSON *string*). */
function normalizeToolCall(tc: PuterToolCall, i: number): { id: string; type: "function"; function: { name: string; arguments: string } } {
  const args = tc.function?.arguments;
  return {
    id: tc.id ?? `call_${i}`,
    type: "function",
    function: { name: tc.function?.name ?? "", arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
  };
}

function normalizeUsage(u: PuterChatResponse["usage"]): { prompt_tokens: number; completion_tokens: number; total_tokens: number } {
  const prompt = u?.prompt_tokens ?? u?.input_tokens ?? 0;
  const completion = u?.completion_tokens ?? u?.output_tokens ?? 0;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: prompt + completion };
}

/** Build an OpenAI `chat.completion` object from a puter non-stream response. */
export function toCompletion(model: string, resp: PuterChatResponse, stamp: number): object {
  const msg = resp.message ?? {};
  const text = contentToText(msg.content);
  const toolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length ? msg.tool_calls.map(normalizeToolCall) : undefined;
  return {
    id: `puter-${stamp}`,
    object: "chat.completion",
    created: Math.floor(stamp / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: toolCalls ? text || null : text, ...(toolCalls ? { tool_calls: toolCalls } : {}) },
        finish_reason: toolCalls ? "tool_calls" : "stop",
      },
    ],
    usage: normalizeUsage(resp.usage),
  };
}

/** Encode the whole (already-complete) response as a short OpenAI SSE stream the SDK can parse. */
function toSSE(model: string, resp: PuterChatResponse, stamp: number): ReadableStream<Uint8Array> {
  const completion = toCompletion(model, resp, stamp) as { choices: [{ message: { content: string | null; tool_calls?: unknown[] }; finish_reason: string }]; usage: unknown };
  const { message, finish_reason } = completion.choices[0];
  const enc = new TextEncoder();
  const base = { id: `puter-${stamp}`, object: "chat.completion.chunk", created: Math.floor(stamp / 1000), model };
  const frames: object[] = [{ ...base, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] }];
  if (message.content) frames.push({ ...base, choices: [{ index: 0, delta: { content: message.content }, finish_reason: null }] });
  if (message.tool_calls) frames.push({ ...base, choices: [{ index: 0, delta: { tool_calls: message.tool_calls.map((tc, i) => ({ index: i, ...(tc as object) })) }, finish_reason: null }] });
  frames.push({ ...base, choices: [{ index: 0, delta: {}, finish_reason }], usage: completion.usage });
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(enc.encode(`data: ${JSON.stringify(f)}\n\n`));
      controller.enqueue(enc.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
}

/** The puter.ai.chat call, injectable so the shim can be tested without the real token/package. */
export type PuterChat = (messages: unknown, opts: Record<string, unknown>) => Promise<PuterChatResponse>;

/**
 * A `fetch` that satisfies the openai-compatible model by routing chat completions through puter.ai.chat.
 * Pass the resulting fetch as the provider's `fetch`. The token defaults to PUTER_AUTH_TOKEN. `chatImpl`
 * is for tests; in production it lazily initializes the real puter client.
 */
export function puterFetch(token?: string, chatImpl?: PuterChat): typeof fetch {
  return (async (_input: Parameters<typeof fetch>[0], requestInit?: Parameters<typeof fetch>[1]): Promise<Response> => {
    const bodyRaw = requestInit?.body;
    let body: Record<string, unknown> = {};
    try {
      if (typeof bodyRaw === "string") body = JSON.parse(bodyRaw) as Record<string, unknown>;
    } catch {
      /* leave empty — handled below */
    }
    const model = String(body.model ?? "z-ai/glm-4.5");
    const messages = body.messages ?? [];
    const wantsStream = body.stream === true;
    const opts: Record<string, unknown> = { model };
    if (body.tools) opts.tools = body.tools;
    if (body.tool_choice) opts.tool_choice = body.tool_choice;
    if (body.temperature != null) opts.temperature = body.temperature;
    if (body.max_tokens != null) opts.max_tokens = body.max_tokens;

    const authToken = token || process.env.PUTER_AUTH_TOKEN || "";
    const stamp = Date.now();
    try {
      const chat: PuterChat = chatImpl ?? (async (m, o) => (await puterClient(authToken)).ai.chat(m, false, o));
      const resp = await chat(messages, opts);
      if (wantsStream) return new Response(toSSE(model, resp, stamp), { status: 200, headers: { "content-type": "text/event-stream" } });
      return new Response(JSON.stringify(toCompletion(model, resp, stamp)), { status: 200, headers: { "content-type": "application/json" } });
    } catch (e) {
      // puter.ai.chat rejects with a plain object (not an Error), so `String(e)` is a useless
      // "[object Object]" — dig out the real message/code so rate-limits etc. are legible.
      const message = errText(e);
      // Surface as an OpenAI-style error body so the SDK's error path (and the fallback chain) handle it.
      return new Response(JSON.stringify({ error: { message: `puter.ai.chat failed: ${message}`, type: "puter_error" } }), { status: 502, headers: { "content-type": "application/json" } });
    }
  }) as typeof fetch;
}
