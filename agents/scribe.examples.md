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
