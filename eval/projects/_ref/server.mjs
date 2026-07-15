// Reference solution for the `fullstack` project — used only by projects-selftest.ts.
import { createServer } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const FILE = "tasks.json";
const load = () => (existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf8")) : { seq: 0, tasks: [] });
const save = (d) => writeFileSync(FILE, JSON.stringify(d));
const PORT = process.env.PORT || 3000;

const HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Tasks</title></head><body>
<h1>Tasks</h1>
<form id="add"><input id="title" placeholder="New task"><button type="submit">Add</button></form>
<ul id="list"></ul>
<script>
async function refresh() {
  const res = await fetch('/api/tasks');
  const tasks = await res.json();
  document.getElementById('list').innerHTML = tasks.map(t => '<li>' + (t.done ? '[x] ' : '[ ] ') + t.title + '</li>').join('');
}
document.getElementById('add').addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = document.getElementById('title').value;
  await fetch('/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title }) });
  document.getElementById('title').value = '';
  refresh();
});
refresh();
</script>
</body></html>`;

const readBody = (req) => new Promise((resolve) => {
  let b = "";
  req.on("data", (c) => { b += c; });
  req.on("end", () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } });
});

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const path = url.pathname;
  const json = (code, obj) => { res.writeHead(code, { "content-type": "application/json" }); res.end(obj === undefined ? "" : JSON.stringify(obj)); };

  if (path === "/" && req.method === "GET") { res.writeHead(200, { "content-type": "text/html" }); res.end(HTML); return; }
  if (path === "/api/tasks" && req.method === "GET") { return json(200, load().tasks); }
  if (path === "/api/tasks" && req.method === "POST") {
    const d = load(); const body = await readBody(req);
    const task = { id: ++d.seq, title: body.title, done: false };
    d.tasks.push(task); save(d); return json(201, task);
  }
  const m = path.match(/^\/api\/tasks\/(\d+)$/);
  if (m) {
    const id = Number(m[1]); const d = load(); const task = d.tasks.find((x) => x.id === id);
    if (!task) return json(404, { error: "not found" });
    if (req.method === "PATCH") { const body = await readBody(req); Object.assign(task, body, { id }); save(d); return json(200, task); }
    if (req.method === "DELETE") { d.tasks = d.tasks.filter((x) => x.id !== id); save(d); res.writeHead(204); res.end(); return; }
  }
  json(404, { error: "not found" });
}).listen(PORT);
