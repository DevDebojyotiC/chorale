import { useState, useRef } from "react";
import { Box, Text, Static, useApp, useInput, render } from "ink";
import TextInput from "ink-text-input";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { buildRegistry } from "../core/model-registry.js";
import { loadAgent } from "../agents/loader.js";
import { resolveModelPlan } from "../core/model-policy.js";
import { runAgent } from "../core/runtime.js";
import { SessionStore } from "../core/session.js";
import type { ChatMessage } from "../core/session.js";
import { setLogLevel } from "../core/log.js";

interface Turn { role: "user" | "assistant" | "system"; text: string }

function App({ initialAgent }: { initialAgent: string }) {
  const { exit } = useApp();
  const config = useRef(loadConfig()).current;
  const registry = useRef(buildRegistry(config)).current;
  const store = useRef(new SessionStore()).current;

  const [agentName, setAgentName] = useState(initialAgent);
  const agentRef = useRef(loadAgent(resolve(config.agents.dir, `${initialAgent}.md`)));
  const sessionId = useRef(store.createSession(agentRef.current.name)).current;
  const history = useRef<ChatMessage[]>([]);

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState("");
  const [activity, setActivity] = useState("");
  const [busy, setBusy] = useState(false);

  const model = resolveModelPlan(agentRef.current, config).model;
  const say = (role: Turn["role"], text: string): void => setTurns((t) => [...t, { role, text }]);

  useInput((ch, key) => {
    if (key.ctrl && ch === "c") { store.close(); exit(); }
  });

  async function submit(value: string): Promise<void> {
    const text = value.trim();
    setInput("");
    if (!text || busy) return;

    if (text === "/exit" || text === "/quit") { store.close(); exit(); return; }
    if (text === "/clear") { setTurns([]); history.current = []; return; }
    if (text.startsWith("/agent ")) {
      const name = text.slice(7).trim();
      const file = resolve(config.agents.dir, `${name}.md`);
      if (existsSync(file)) { agentRef.current = loadAgent(file); setAgentName(name); say("system", `switched to agent: ${name}`); }
      else say("system", `no such agent: ${name}`);
      return;
    }

    say("user", text);
    store.appendMessage(sessionId, "user", text);
    setBusy(true); setStreaming(""); setActivity("thinking…");
    let acc = "";
    try {
      const res = await runAgent({
        config, registry, agent: agentRef.current, prompt: text, history: history.current,
        onToken: (tk) => { acc += tk; setStreaming(acc); },
        onEvent: (e) => setActivity(`${e.type} · ${e.text}`),
      });
      store.appendMessage(sessionId, "assistant", res.text, res.model);
      if (res.usage) store.recordUsage(sessionId, res.model, res.usage.inputTokens ?? 0, res.usage.outputTokens ?? 0);
      history.current = [...history.current, { role: "user", content: text }, { role: "assistant", content: res.text }];
      say("assistant", res.text);
    } catch (e) {
      say("system", `error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false); setStreaming(""); setActivity("");
    }
  }

  const color = (r: Turn["role"]): string => (r === "user" ? "green" : r === "assistant" ? "magenta" : "gray");
  const label = (r: Turn["role"]): string => (r === "user" ? "you" : r === "assistant" ? agentName : "·");

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text color="cyan" bold>Chorale </Text>
        <Text dimColor>{agentName} · {model} · {sessionId}</Text>
      </Box>

      <Static items={turns}>
        {(t, i) => (
          <Box key={i} flexDirection="column" marginTop={1}>
            <Text color={color(t.role)} bold>{label(t.role)}</Text>
            <Text>{t.text}</Text>
          </Box>
        )}
      </Static>

      {busy && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="magenta" bold>{agentName}</Text>
          {streaming ? <Text>{streaming}</Text> : null}
          {activity ? <Text color="yellow" dimColor>  ⚙ {activity}</Text> : null}
        </Box>
      )}

      {!busy && (
        <Box marginTop={1}>
          <Text color="green">› </Text>
          <TextInput value={input} onChange={setInput} onSubmit={(v) => void submit(v)} placeholder="message · /agent <name> · /clear · /exit" />
        </Box>
      )}
    </Box>
  );
}

/** Launch the interactive TUI. Requires a TTY. */
export function startTui(opts: { agent?: string }): void {
  setLogLevel("error"); // keep pipeline diagnostics out of the UI
  render(<App initialAgent={opts.agent ?? "general"} />);
}
