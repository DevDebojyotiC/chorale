import { describe, it, expect } from "vitest";
import { envVarOf, upsertEnvVar, readEnvVar, maskKey } from "../desktop/settings";

describe("Phase 5 — settings (provider key management)", () => {
  it("envVarOf extracts the ${VAR} name, null for sentinels/local", () => {
    expect(envVarOf("${ZAI_API_KEY}")).toBe("ZAI_API_KEY");
    expect(envVarOf("${PUTER_AUTH_TOKEN}")).toBe("PUTER_AUTH_TOKEN");
    expect(envVarOf("ollama")).toBeNull(); // sentinel — no key needed
    expect(envVarOf("sk-mock")).toBeNull();
    expect(envVarOf(undefined)).toBeNull();
  });

  it("upsertEnvVar replaces an existing var and preserves the rest", () => {
    const env = "PORT=3000\nZAI_API_KEY=old\nJWT_SECRET=abc\n";
    const out = upsertEnvVar(env, "ZAI_API_KEY", "new-key-123");
    expect(out).toContain("ZAI_API_KEY=new-key-123");
    expect(out).toContain("PORT=3000");
    expect(out).toContain("JWT_SECRET=abc");
    expect(out.match(/ZAI_API_KEY=/g)!.length).toBe(1); // not duplicated
  });

  it("upsertEnvVar appends a new var (and handles an empty file)", () => {
    expect(upsertEnvVar("PORT=3000\n", "NEW_KEY", "v")).toBe("PORT=3000\nNEW_KEY=v\n");
    expect(upsertEnvVar("", "NEW_KEY", "v")).toBe("NEW_KEY=v\n");
  });

  it("readEnvVar reads a value or empty string", () => {
    expect(readEnvVar("ZAI_API_KEY=secret123\n", "ZAI_API_KEY")).toBe("secret123");
    expect(readEnvVar("ZAI_API_KEY=\n", "ZAI_API_KEY")).toBe("");
    expect(readEnvVar("OTHER=x\n", "ZAI_API_KEY")).toBe("");
  });

  it("maskKey shows only the ends, never the whole secret", () => {
    expect(maskKey("")).toBe("");
    expect(maskKey("short")).toBe("••••••");
    const masked = maskKey("sk-abcdefghijklmnop");
    expect(masked).toBe("sk-…nop");
    expect(masked).not.toContain("defghij");
  });
});
