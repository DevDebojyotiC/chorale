import { describe, it, expect } from "vitest";
import { extractContract, formatContract, hasContract } from "../src/core/contract";

describe("Phase 4 — project contract extraction (fullstack lever #2)", () => {
  // The exact shape of the fullstack experiment: backend mounts routers at /auth and /notes,
  // route files define the paths. The frontend must see "POST /auth/login", not guess "/api/...".
  const backend = [
    {
      path: "backend/src/app.ts",
      content:
        "import express from 'express';\n" +
        "import authRoutes from './routes/auth.routes';\n" +
        "import noteRoutes from './routes/note.routes';\n" +
        "const app = express();\n" +
        "app.use('/auth', authRoutes);\n" +
        "app.use('/notes', noteRoutes);\n" +
        "export default app;\n",
    },
    {
      path: "backend/src/server.ts",
      content: "import app from './app';\napp.listen(3000, () => console.log('up'));\n",
    },
    {
      path: "backend/src/routes/auth.routes.ts",
      content: "import { Router } from 'express';\nconst router = Router();\nrouter.post('/register', h);\nrouter.post('/login', h);\nexport default router;\n",
    },
    {
      path: "backend/src/routes/note.routes.ts",
      content: "import { Router } from 'express';\nconst router = Router();\nrouter.get('/', h);\nrouter.post('/', h);\nrouter.delete('/:id', h);\nexport default router;\n",
    },
    {
      path: "backend/src/models/database.ts",
      content: "db.exec(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, email TEXT, password TEXT);`);\n" + "db.exec(`CREATE TABLE IF NOT EXISTS notes (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT, content TEXT);`);\n",
    },
    {
      path: "backend/src/models/user.model.ts",
      content: "export interface User { id: number; email: string; }\nexport function findUser() {}\n",
    },
  ];

  it("composes real endpoints from mount prefix + route path (no invented /api prefix)", () => {
    const c = extractContract(backend);
    expect(c.endpoints).toContain("POST /auth/register");
    expect(c.endpoints).toContain("POST /auth/login");
    expect(c.endpoints).toContain("GET /notes");
    expect(c.endpoints).toContain("POST /notes");
    expect(c.endpoints).toContain("DELETE /notes/:id");
    // crucially NOT an /api-prefixed version — that mismatch is exactly the bug #2 fixes
    expect(c.endpoints.some((e) => e.includes("/api/"))).toBe(false);
  });

  it("extracts base URL, tables, and exported symbols", () => {
    const c = extractContract(backend);
    expect(c.baseUrl).toBe("http://localhost:3000");
    expect(c.tables.join(" ")).toMatch(/users\(id, email, password\)/);
    expect(c.tables.join(" ")).toMatch(/notes\(id, user_id, title, content\)/);
    expect(c.exports).toContain("User");
    expect(c.exports).toContain("findUser");
  });

  it("formatContract renders an injectable block that steers away from an /api guess", () => {
    const block = formatContract(extractContract(backend));
    expect(block).toMatch(/http:\/\/localhost:3000/);
    expect(block).toMatch(/POST \/auth\/login/);
    expect(block).toMatch(/do NOT add an \/api prefix/i);
    expect(hasContract(extractContract(backend))).toBe(true);
  });

  it("empty project yields an empty contract", () => {
    const c = extractContract([{ path: "README.md", content: "# hi" }]);
    expect(hasContract(c)).toBe(false);
    expect(c.endpoints).toEqual([]);
  });
});
