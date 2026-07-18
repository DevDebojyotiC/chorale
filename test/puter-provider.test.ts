import { describe, it, expect } from "vitest";
import { puterFetch, toCompletion, type PuterChat } from "../src/core/puter-provider";

const call = async (fetchImpl: ReturnType<typeof puterFetch>, body: object) =>
  fetchImpl("https://api.puter.local/v1/chat/completions", { method: "POST", body: JSON.stringify(body) } as RequestInit);

describe("Phase 4 — Puter GLM provider (openai-envelope shim)", () => {
  it("wraps a text reply in an OpenAI chat.completion with finish_reason stop", () => {
    const c = toCompletion("z-ai/glm-4.6", { message: { content: "hello world" }, usage: { input_tokens: 5, output_tokens: 3 } }, 1_700_000_000_000) as any;
    expect(c.object).toBe("chat.completion");
    expect(c.model).toBe("z-ai/glm-4.6");
    expect(c.choices[0].message.content).toBe("hello world");
    expect(c.choices[0].finish_reason).toBe("stop");
    expect(c.usage).toEqual({ prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 });
  });

  it("maps tool calls to the OpenAI shape (arguments stringified, finish_reason tool_calls)", () => {
    const c = toCompletion("z-ai/glm-4.6", { message: { content: "", tool_calls: [{ id: "x1", function: { name: "plan", arguments: { steps: [1] } } }] } }, 1) as any;
    expect(c.choices[0].finish_reason).toBe("tool_calls");
    const tc = c.choices[0].message.tool_calls[0];
    expect(tc).toEqual({ id: "x1", type: "function", function: { name: "plan", arguments: '{"steps":[1]}' } });
    expect(c.choices[0].message.content).toBeNull(); // content null when only tool calls
  });

  it("coerces array/object content to text", () => {
    const arr = toCompletion("m", { message: { content: [{ type: "text", text: "a" }, { text: "b" }] } }, 1) as any;
    expect(arr.choices[0].message.content).toBe("ab");
    const obj = toCompletion("m", { message: { content: { text: "z" } } }, 1) as any;
    expect(obj.choices[0].message.content).toBe("z");
  });

  it("non-stream fetch returns a parseable OpenAI JSON body", async () => {
    const chat: PuterChat = async () => ({ message: { content: "hi" } });
    const res = await call(puterFetch("tok", chat), { model: "z-ai/glm-4.6", messages: [{ role: "user", content: "hey" }] });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const json = (await res.json()) as any;
    expect(json.choices[0].message.content).toBe("hi");
  });

  it("passes tools + params through to puter.ai.chat", async () => {
    let seen: any;
    const chat: PuterChat = async (_m, opts) => {
      seen = opts;
      return { message: { content: "ok" } };
    };
    await call(puterFetch("tok", chat), {
      model: "z-ai/glm-4.6",
      messages: [],
      tools: [{ type: "function", function: { name: "plan", parameters: {} } }],
      tool_choice: "auto",
      temperature: 0.2,
      max_tokens: 4096,
    });
    expect(seen.model).toBe("z-ai/glm-4.6");
    expect(seen.tools[0].function.name).toBe("plan");
    expect(seen.tool_choice).toBe("auto");
    expect(seen.temperature).toBe(0.2);
    expect(seen.max_tokens).toBe(4096);
  });

  it("streaming request returns SSE frames ending in [DONE]", async () => {
    const chat: PuterChat = async () => ({ message: { content: "streamed" } });
    const res = await call(puterFetch("tok", chat), { model: "z-ai/glm-4.6", messages: [], stream: true });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const text = await res.text();
    expect(text).toContain('"role":"assistant"');
    expect(text).toContain('"content":"streamed"');
    expect(text).toContain('"finish_reason":"stop"');
    expect(text.trim().endsWith("data: [DONE]")).toBe(true);
  });

  it("a puter failure becomes a 502 OpenAI-style error body (so the fallback chain engages)", async () => {
    const chat: PuterChat = async () => {
      throw new Error("rate limited");
    };
    const res = await call(puterFetch("tok", chat), { model: "z-ai/glm-4.6", messages: [] });
    expect(res.status).toBe(502);
    const json = (await res.json()) as any;
    expect(json.error.message).toMatch(/rate limited/);
  });

  it("surfaces a plain-object rejection legibly (not [object Object])", async () => {
    // puter.ai.chat rejects with a plain object, e.g. { message, code } — extract the real message.
    const chat: PuterChat = async () => {
      throw { message: "No usage left for request.", code: "insufficient_funds" };
    };
    const res = await call(puterFetch("tok", chat), { model: "z-ai/glm-4.6", messages: [] });
    const json = (await res.json()) as any;
    expect(json.error.message).toContain("No usage left for request.");
    expect(json.error.message).toContain("insufficient_funds");
    expect(json.error.message).not.toContain("[object Object]");
  });
});
