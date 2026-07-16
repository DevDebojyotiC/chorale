## Worked examples

These show the level of decomposition expected. In practice you call the `plan` tool with this
structure; the text form here is for illustration.

### Example 1 — a complex, multi-subsystem request

**Task:** "Build a small library-management app: catalog books, register members, check books in
and out."

After reading the repo (an empty TypeScript/Express project), a good plan:

```
Summary: A library app — data model, REST API for catalog/members/loans, a minimal UI, and tests.

1. [coder] Design and create the data model (schema)
   depends: none
   accept: books, members, loans tables (or types + a migration) exist and compile
   files: src/db/schema.ts (new)
2. [coder] Catalog + member CRUD endpoints (api)
   depends: 1
   accept: GET/POST/PUT/DELETE for books and members return correct status codes
   files: src/api/books.ts (new), src/api/members.ts (new)
3. [coder] Checkout / return endpoints (api)
   depends: 1, 2
   accept: checkout decrements availability and rejects an unavailable book; return restores it
   files: src/api/loans.ts (new)
4. [coder] Minimal web UI to browse and check out (ui)
   depends: 2, 3
   accept: a page lists books and can check one out via the API
   files: public/index.html (new), src/ui/app.ts (new)
5. [test-writer] API and loan-rule tests (tests)
   depends: 2, 3
   accept: happy-path + edge cases (double checkout, unknown id) pass
   files: test/api.test.ts (new)
6. [scribe] README with setup and API reference (docs)
   depends: 2, 3
   accept: README documents each endpoint and how to run the app
   files: README.md (new)
```

Why this is a good plan: it grounds every file, orders honestly (schema → API → UI; tests/docs after
the API), assigns each step to the right specialist, and every acceptance criterion is checkable.
Steps 2 and 5 can proceed in parallel once 1 is done — expressed by their dependencies, not a flat
sequence.

### Example 2 — a request that needs an architecture decision first

**Task:** "Add a plugin system so third parties can add connectors."

```
Summary: A plugin system — first decide the extension contract, then implement loading and a sample.

1. [coder] Decide the plugin contract and loading strategy (other) [designDecision]
   depends: none
   accept: a documented interface (registration, lifecycle, capability boundary) is chosen
   files: src/plugins/contract.ts (new)
2. [coder] Implement the plugin loader against the contract (api)
   depends: 1
   accept: loader discovers, validates, and initializes plugins; rejects malformed ones
   files: src/plugins/loader.ts (new)
3. [coder] A reference connector plugin (api)
   depends: 2
   accept: the sample plugin loads and exposes one working capability end-to-end
   files: src/plugins/examples/sample.ts (new)
4. [scribe] Plugin authoring guide (docs)
   depends: 1, 2
   accept: a guide explains the contract and walks through writing a plugin
   files: docs/plugins.md (new)
```

Note step 1 is marked as a design decision — it's few files but high design-depth, which is exactly
the kind of step that makes an otherwise-small task worth planning.

### Example 3 — a genuinely simple request (don't over-plan)

**Task:** "Add pagination to the GET /users endpoint."

```
Summary: Add limit/offset pagination to the users list endpoint.

1. [coder] Add limit/offset pagination to GET /users (api)
   depends: none
   accept: the endpoint accepts limit & offset, returns the page and a total count
   files: src/api/users.ts (existing)
```

One step, one specialist, one layer — this is *trivial*, not complex. A good planner right-sizes:
it doesn't manufacture ceremony for a small change.
