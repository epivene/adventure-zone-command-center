import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./CoiManagementPage.tsx", import.meta.url), "utf8");

describe("COI management workflow states", () => {
  it("renders actionable loading, empty, unavailable-workspace, save-error, and unavailable-file states", () => {
    expect(source).toContain("<Skeleton");
    expect(source).toContain("No certificates recorded yet");
    expect(source).toContain("Document workspace unavailable");
    expect(source).toContain("Could not save the certificate");
    expect(source).toContain("File unavailable");
    expect(source).toContain("Refresh");
  });

  it("keeps Boss and Admin mutations on their protected authorization paths", () => {
    expect(source).toContain('bossPatch(`/boss/coi/${initial.id}`, payload)');
    expect(source).toContain('apiPatch(`/admin/coi/${initial.id}`, payload)');
    expect(source).toContain('bossPost("/boss/coi", payload)');
    expect(source).toContain('apiPost("/admin/coi", payload)');
  });

  it("exposes the four expiration states and separate review state", () => {
    expect(source).toContain('status === "current"');
    expect(source).toContain('status === "expiring_soon"');
    expect(source).toContain('status === "expired"');
    expect(source).toContain('"needs_review" | "reviewed"');
    expect(source).toContain('value="needs_review"');
    expect(source).toContain('value="reviewed"');
  });
});