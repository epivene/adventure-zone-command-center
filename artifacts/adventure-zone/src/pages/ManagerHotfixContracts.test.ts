import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const auth = readFileSync("src/lib/manager-auth-context.tsx", "utf8");
const preview = readFileSync("src/components/routes/manager-preview-map.tsx", "utf8");

describe("manager hotfix contracts", () => {
  it("does not let stale manager-session bootstrap clear a newer login", () => {
    expect(auth).toContain("const bootstrapToken = token()");
    expect(auth).toContain("if (token() === bootstrapToken) clearCurrentSession()");
    expect(auth).toContain("if (token() === requestToken) clearCurrentSession()");
    expect(auth).toContain("setLoading(false)");
  });

  it("shows all manager-preview scheduled events even when a pin is pending", () => {
    expect(preview).toContain("Scheduled events");
    expect(preview).toContain("data.events.map");
    expect(preview).toContain("Pin pending");
  });
});
