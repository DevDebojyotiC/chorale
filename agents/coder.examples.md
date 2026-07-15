# Worked examples — operational patterns (adapt, don't copy)

Short, correct shapes for the details that most often go wrong. Follow the pattern; fit it to the task.

### A server reads its port from the environment (never hardcode it)
```js
import { createServer } from "node:http";
const PORT = process.env.PORT || 3000; // configurable, with a sensible default
createServer((req, res) => { /* handle */ }).listen(PORT);
```

### A CLI reads its arguments and persists across runs
```js
import { readFileSync, writeFileSync, existsSync } from "node:fs";
const [cmd, ...args] = process.argv.slice(2);
const state = existsSync("data.json") ? JSON.parse(readFileSync("data.json", "utf8")) : { seq: 0, items: [] };
// ...mutate state based on cmd/args...
writeFileSync("data.json", JSON.stringify(state)); // persist so the next process sees it
```

### A REST API uses correct status codes and content type
```js
// POST create -> 201 ; GET ok -> 200 ; not found -> 404 ; DELETE ok -> 204 (no body)
const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(body === undefined ? "" : JSON.stringify(body)); };
```

### Serve HTML from a separate file — never inline a big page in a template literal
Embedding a full HTML page (especially one with its own `<script>`) inside a JS backtick
string is the #1 syntax-error trap: a nested backtick closes the string early. Put the page
in its own `.html` file and read it. No nesting, nothing to escape.
```js
// index.html   <-- a normal .html file; its <script> can use backticks freely
// server.mjs:
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html" }); res.end(html); return; }
  // ...API routes...
}).listen(process.env.PORT || 3000);
```

### An ES module always exports what the task asked for
```js
export function solve(input) { /* ... */ }   // named export the caller can import
```

The point of these is the **contract details** — env-configured ports, argv, persistence, status codes, exports — the parts that make code actually run as specified.
