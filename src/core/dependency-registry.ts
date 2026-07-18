/**
 * Dependency version registry (Phase 4 · contract-first · lever #2/#3).
 *
 * When the deterministic skeleton adds a package to package.json, it needs a version RANGE that npm can
 * actually resolve — a wrong pin is as fatal as a missing dependency. This table carries known-good
 * caret ranges for the packages generated apps use most, with two rules baked in from real boot
 * failures: native modules are pinned to a major that ships a prebuilt binary for a current Node (so
 * `npm install` never falls through to node-gyp), and anything unknown falls back to `latest` — always
 * resolvable, never a fabricated version that doesn't exist. Pure data + tiny helpers; unit-testable.
 */

/** Runtime packages → a known-good caret range. Native modules pinned to a prebuild-shipping major. */
export const RUNTIME_VERSIONS: Record<string, string> = {
  express: "^4.21.2",
  cors: "^2.8.5",
  helmet: "^8.0.0",
  morgan: "^1.10.0",
  "body-parser": "^1.20.3",
  "cookie-parser": "^1.4.7",
  "express-rate-limit": "^7.5.0",
  dotenv: "^16.4.7",
  jsonwebtoken: "^9.0.2",
  bcryptjs: "^2.4.3",
  argon2: "^0.41.1",
  zod: "^3.24.1",
  joi: "^17.13.3",
  "better-sqlite3": "^12.2.0", // ^12 ships Node-22 prebuilds; ^9 (older gen) forced node-gyp → boot failure
  "sqlite3": "^5.1.7",
  pg: "^8.13.1",
  mysql2: "^3.12.0",
  mongoose: "^8.9.5",
  ioredis: "^5.4.2",
  redis: "^4.7.0",
  knex: "^3.1.0",
  "drizzle-orm": "^0.38.3",
  "@prisma/client": "^6.2.1",
  ws: "^8.18.0",
  "socket.io": "^4.8.1",
  uuid: "^11.0.5",
  nanoid: "^5.0.9",
  axios: "^1.7.9",
  "node-fetch": "^3.3.2",
  "date-fns": "^4.1.0",
  dayjs: "^1.11.13",
  lodash: "^4.17.21",
  chalk: "^5.4.1",
  commander: "^13.0.0",
  fastify: "^5.2.1",
  "@fastify/cors": "^10.0.2",
  multer: "^1.4.5-lts.1",
  nodemailer: "^6.9.16",
  "http-proxy-middleware": "^3.0.3",
  react: "^18.3.1",
  "react-dom": "^18.3.1",
  "react-router-dom": "^7.1.1",
};

/** Dev-only packages → a known-good caret range. */
export const DEV_VERSIONS: Record<string, string> = {
  tsx: "^4.19.2",
  typescript: "^5.7.3",
  "@types/node": "^22.10.5",
  "@types/express": "^5.0.0",
  "@types/jsonwebtoken": "^9.0.7",
  "@types/cors": "^2.8.17",
  "@types/better-sqlite3": "^7.6.12",
  "@types/ws": "^8.5.13",
  "@types/lodash": "^4.17.14",
  "@types/multer": "^1.4.12",
  "@types/nodemailer": "^6.4.17",
  vitest: "^3.0.2",
  nodemon: "^3.1.9",
  eslint: "^9.18.0",
  prettier: "^3.4.2",
};

/** Prefixes/names that belong in devDependencies rather than dependencies. */
const DEV_NAME = /^@types\//;
const DEV_TOOLS = new Set(["tsx", "typescript", "ts-node", "ts-jest", "nodemon", "vitest", "jest", "mocha", "supertest", "eslint", "prettier", "concurrently"]);

/** True when a package conventionally belongs in devDependencies (types, test/build tooling). */
export function isDevPackage(pkg: string): boolean {
  return DEV_NAME.test(pkg) || DEV_TOOLS.has(pkg) || pkg.startsWith("@vitest/") || pkg.startsWith("@jest/") || pkg.startsWith("@testing-library/");
}

/** A version range npm can resolve for `pkg`: the curated pin if known, else `latest` (always resolvable). */
export function versionFor(pkg: string): string {
  return DEV_VERSIONS[pkg] ?? RUNTIME_VERSIONS[pkg] ?? "latest";
}
