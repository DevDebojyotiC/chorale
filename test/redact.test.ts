import { describe, it, expect } from "vitest";
import { redactSecrets } from "../src/core/redact";

describe("Phase 2 — secret redaction", () => {
  it("scrubs exact secret values pulled from the environment", () => {
    process.env.CHORALE_TEST_API_KEY = "supersecretvalue1234";
    try {
      expect(redactSecrets("Authorization uses supersecretvalue1234 here")).toBe("Authorization uses *** here");
    } finally {
      delete process.env.CHORALE_TEST_API_KEY;
    }
  });

  it("masks Bearer tokens and provider key prefixes", () => {
    expect(redactSecrets("headers: Bearer abcdef1234567890XYZ")).toMatch(/Bearer \*\*\*/);
    expect(redactSecrets("key=sk-ABCDEFGHIJKLMNOPQRSTUV")).toMatch(/sk-\*\*\*/);
    expect(redactSecrets("hf_ABCDEFGHIJKLMNOPQRSTUV token")).toMatch(/hf_\*\*\*/);
  });

  it("leaves ordinary text untouched", () => {
    expect(redactSecrets("build succeeded in 1234ms with 5 files")).toBe("build succeeded in 1234ms with 5 files");
  });
});
