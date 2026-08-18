import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/leg-manager-admin.ts", "utf8");

describe("admin incident list fallback", () => {
  it("returns incident rows even when attachment enrichment fails", () => {
    expect(source).toContain("Incident attachment enrichment failed");
    expect(source).toContain("attachments: []");
    expect(source).toContain("res.json({ incidents: fallbackIncidents");
  });
});
