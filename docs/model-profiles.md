# Model Profiles — Design

> How Chorale maps agents to models across local, serverless, and hybrid setups —
> with one flexible mechanism instead of five hard-coded modes.

**Status:** Design (approved for implementation) · **Date:** 2026-07-15

## 1. Problem

Different agents want different models (a code model for `coder`, a general model for
`research`, a cheap one for utility tasks). But *where* those models run — local, serverless,
or a mix — depends on the user's hardware and keys, and on limited local VRAM one model may need
to swap in/out on every switch. Users described five setups they want:

1. **Local Single** — one local model for everything.
2. **Local Varied** — different local models per role.
3. **Hybrid: 1 local + 1 serverless** — local for light work, one serverless for heavy.
4. **Hybrid: 1 local + many serverless** — local base, different serverless specialists.
5. **Hybrid Custom** — arbitrary per-agent assignment.

These are not five features. They are one mapping (agent → model) filled in differently.

## 2. Concepts

### Model Profile
A named routing policy. Selecting a profile decides every agent's model:

```
Profile {
  description?: string
  default?:   ModelRef                 // catch-all for any agent
  tiers?:     Record<Tier, ModelRef>   // by agent role
  agents?:    Record<AgentName, ModelRef>  // per-agent override
  fallbacks?: ModelRef[]               // profile-wide safety net (appended)
}
```
`ModelRef` = `"<provider>:<model>"` or the `${base}` sentinel (existing convention).

### Tier
An agent's **role**, independent of any model. Declared in `agent.md` frontmatter as `tier:`.
Conventional set (free-form, these are just the recommended names):

| Tier | Agents | Typical need |
|---|---|---|
| `orchestrator` | orchestrator | reliable tool-calling / routing |
| `code` | coder | strong code model |
| `research` | research | capable + tool-use |
| `chat` | general | light / cheap |
| `utility` | token-reducer, aux tasks | cheapest |

Tiers let a profile map by role (`tiers.code = …`) so a new agent inherits the right model just by
tagging its tier — no per-profile edits.

## 3. Resolution precedence

For each agent, per run, the **primary model** is the first of:

```
1. --model CLI flag
2. profile.agents[agent.name]
3. profile.tiers[agent.tier]          (if the agent declares a tier)
4. profile.default
5. agent.md `model`                   (may be ${base})
6. config.base.model
```

The **fallback chain** is composed (deduped, in order):

```
agent.fallbacks  ++  profile.fallbacks  ++  config.base.fallbacks  ++  [config.base.model]
```

`${base}` in any position resolves to `config.base.model`. With **no active profile**, steps 2–4
are skipped → resolution is exactly today's behavior (agent.md `model` + base). Fully backward compatible.

## 4. The five modes as presets

Chorale ships these as built-in profiles (users edit the model refs to match what they have):

```json5
profiles: {
  // 1. Local Single — one model, zero swapping
  "local-single": { default: "ollama:qwen2.5-coder:3b" },

  // 2. Local Varied — different local models per role (accepts swap latency)
  "local-varied": {
    tiers: { code: "ollama:qwen2.5-coder:3b", research: "ollama:llama3.2:3b", chat: "ollama:qwen2.5:3b" },
    default: "ollama:qwen2.5-coder:3b",
  },

  // 3. Hybrid: 1 local + 1 serverless — local light, one serverless for heavy work
  "hybrid-1L-1S": {
    default: "ollama:qwen2.5-coder:3b",
    tiers: { code: "fireworks:accounts/fireworks/models/glm-5p2",
             research: "fireworks:accounts/fireworks/models/glm-5p2",
             orchestrator: "fireworks:accounts/fireworks/models/glm-5p2" },
    fallbacks: ["ollama:qwen2.5-coder:3b"], // stay usable if serverless is down
  },

  // 4. Hybrid: 1 local + many serverless — a specialist per role
  "hybrid-1L-manyS": {
    default: "ollama:qwen2.5-coder:3b",
    tiers: { code: "fireworks:accounts/fireworks/models/glm-5p2",
             research: "hf:Qwen/Qwen2.5-7B-Instruct",
             orchestrator: "fireworks:accounts/fireworks/models/kimi-k2p6" },
    fallbacks: ["ollama:qwen2.5-coder:3b"],
  },

  // 5. Hybrid Custom — empty profile → each agent.md's own model wins
  "custom": {},
}
```

Every mode is the *same* resolver over a different profile. "Custom" is simply the empty profile.

## 5. Selecting a profile

- Config: `activeProfile: "hybrid-1L-1S"`.
- CLI: `chorale --profile hybrid-1L-1S "…"` (overrides config for the run).
- `chorale profiles` — list profiles and print the resulting **agent → model** table (dry-run resolution).

## 6. Ergonomics

- **`chorale init`** wizard: detects installed Ollama models + which API keys are set, then generates a
  sensible profile (single-local on tight VRAM; hybrid if keys exist) and writes it to config.
- **Swap-cost awareness (advisory, never blocking):**
  - On load, if a profile assigns **≥2 distinct local (`ollama:`) models**, log: *"heads-up: N local models
    in this profile; on limited VRAM each switch reloads (~10–30 s)."*
  - Log a one-line note right **before** a local model swap is triggered, so a reload never reads as a hang.

## 7. Config schema (additions)

```
ChoraleConfig {
  ...existing (base, providers, agents, skills, mcp, permissions, defaults)...
  activeProfile?: string
  profiles?: Record<string, {
    description?: string
    default?: string
    tiers?: Record<string, string>
    agents?: Record<string, string>
    fallbacks?: string[]
  }>
}
```
`agent.md` frontmatter gains optional `tier?: string`.

## 8. Implementation plan

| File | Change |
|---|---|
| `src/core/config.ts` | add `activeProfile` + `profiles` to the zod schema |
| `src/agents/loader.ts` | parse optional `tier` into `AgentSpec` |
| **new** `src/core/model-policy.ts` | `resolveModelPlan(agent, config, cliModel?, profileName?) → { model, fallbacks }` implementing §3 |
| `src/core/runtime.ts` | replace the inline `rawChain` construction with one `resolveModelPlan(...)` call |
| `src/index.ts` | `--profile <name>` flag; `chorale profiles` subcommand (dry-run table) |
| `config/chorale.config.json5` | ship the 5 preset profiles (commented) + `activeProfile` example |
| `agents/*.md` | add `tier:` to the built-in agents (orchestrator/code/research/chat) |
| `test/` | unit tests for `resolveModelPlan` across all five profile shapes |

The runtime already computes a model+fallback chain in exactly one place (`runAgent`), so this is a
localized swap of *how that chain is derived* — small blast radius.

## 9. Backward compatibility

- No `profiles` / `activeProfile` set → `resolveModelPlan` skips profile steps → identical to today.
- Existing `agent.md` `model`/`fallbacks` and `base` still work and remain the final fallback.
- `tier` is optional; agents without it just skip the tier step.

## 10. Open questions / future

- **`fallbackMode: "append" | "replace"`** per profile (v1 = always append). 
- **Auto VRAM detection** to auto-pick single-local vs hybrid in `chorale init` (v1 = ask/keys-based).
- **Per-tier utility model** for compaction/aux once the token-reducer lands.
- **Profile inheritance** (a profile `extends` another) if preset sprawl appears.
