// Minimal mock of the OpenAI-compatible Chat Completions streaming API.
// Used to prove Chorale can drive ANY OpenAI-compatible endpoint offline —
// no Ollama, no API keys required. Not part of the shipped runtime.
import { createServer } from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 4599);

const server = createServer((req, res) => {
  if (req.method === "POST" && req.url?.startsWith("/v1/chat/completions")) {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      let payload = {};
      try {
        payload = JSON.parse(body);
      } catch {
        /* ignore */
      }
      const userMsg = (payload.messages ?? [])
        .filter((m) => m.role === "user")
        .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
        .join(" ");
      const model = payload.model ?? "mock";
      const reply =
        `Hello from the mock OpenAI-compatible server (model=${model}). ` +
        `You said: "${String(userMsg).slice(0, 100)}". ` +
        `This proves Chorale drives any OpenAI-compatible endpoint.`;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });

      const id = "chatcmpl-mock";
      const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);
      const words = reply.split(" ");
      let i = 0;

      send({ id, object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] });

      const timer = setInterval(() => {
        if (i < words.length) {
          const content = (i === 0 ? "" : " ") + words[i];
          send({ id, object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: { content }, finish_reason: null }] });
          i++;
        } else {
          clearInterval(timer);
          send({ id, object: "chat.completion.chunk", created: 0, model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
          send({ id, object: "chat.completion.chunk", created: 0, model, choices: [], usage: { prompt_tokens: 12, completion_tokens: words.length, total_tokens: 12 + words.length } });
          res.write("data: [DONE]\n\n");
          res.end();
        }
      }, 10);
    });
    return;
  }

  if (req.method === "GET" && req.url?.startsWith("/v1/models")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ object: "list", data: [{ id: "test-model", object: "model" }] }));
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-openai listening on http://127.0.0.1:${PORT}/v1`);
});
