# Worked scribe examples

Study the discipline: read the real files first, reference only what exists, and edit without changing facts.

## Example 1 — a grounded README section

The workspace actually contains: `src/index.js` (exports `run`), `package.json` (scripts: `start`, `test`), and `LICENSE`.

Good output (every claim is backed by a file that exists):
```markdown
## Usage

```js
import { run } from "./src/index.js";
run();
```

## Scripts
- `npm start` — start the app
- `npm test` — run the tests

Licensed under [LICENSE](LICENSE).
```

What this does **not** do: it does not invent a `docs/` folder, a `build` script, or a `Config` class that aren't in the files. If the reader would want an install step and none exists, write "Not documented yet" rather than a fabricated command.

## Example 2 — a meaning-preserving edit

Before:
```
The functon retrys the requst up to three times, if it keeps failing it throw's an error.
```

After (grammar/clarity fixed, the facts — 3 retries, then throws — unchanged):
```
The function retries the request up to three times; if it still fails, it throws an error.
```

The edit fixes spelling, punctuation, and flow. It does **not** change "three" to another number or soften "throws an error" — altering a technical fact while "improving" prose is the worst kind of doc bug.

## Example 3 — reference-safe rename

Task: rename `guide.md` → `docs/user-guide.md`.
1. `move` from `guide.md` to `docs/user-guide.md`. The tool returns `references` (e.g. `README.md:12` links to `guide.md`).
2. For each reference, `edit` the link to the new path (`guide.md` → `docs/user-guide.md`).
3. `grep` for the old name to confirm nothing still points at it.

Never leave a dangling link, and never delete the file instead of moving it.

## Example 4 — a bespoke designed HTML report (design mode)

After reading a source that says *"Gemma scored 9, gpt-oss scored 10"*, author a self-contained styled report — every number grounded:

```html
<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
:root{--accent:#4f46e5;--fg:#1f2937;--bg:#fff;--panel:#f7f8fa;--border:#e5e7eb}
@media (prefers-color-scheme:dark){:root{--fg:#e5e7eb;--bg:#0f1117;--panel:#171a21;--border:#2a2f3a}}
body{font-family:system-ui,sans-serif;color:var(--fg);background:var(--bg);max-width:52rem;margin:0 auto;padding:2rem}
.cover{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:2rem;border-radius:10px}
table{border-collapse:collapse;width:100%}thead th{background:var(--accent);color:#fff}
td,th{padding:.5rem;border-top:1px solid var(--border)}tbody tr:nth-child(even){background:var(--panel)}
.bar{height:1rem;background:var(--accent);border-radius:5px}
@media print{.cover{-webkit-print-color-adjust:exact}}
</style></head><body>
<div class="cover"><h1>Model Benchmark</h1></div>
<table><thead><tr><th>Model</th><th>Score</th></tr></thead>
<tbody><tr><td>Gemma</td><td>9</td></tr><tr><td>gpt-oss</td><td>10</td></tr></tbody></table>
<div class="bar" style="width:90%"></div><div class="bar" style="width:100%"></div>
</body></html>
```

The scores `9` and `10` come straight from the source. The design is bespoke; the data is grounded — that is the point of design mode.
