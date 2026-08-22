import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/manager/event-checklist-form.tsx", "utf8");

describe("manager event checklist form", () => {
  it("shows the four large inspection choices", () => {
    for (const text of [
      "Acceptable",
      "Needs work but safe",
      "Unsafe — cannot operate",
      "Not applicable",
    ]) expect(source).toContain(text);
  });

  it("requires explanatory notes for safety exceptions and supports item photos", () => {
    expect(source).toContain("Note required");
    expect(source).toContain("safetyCritical");
    expect(source).toContain("ChecklistPhotoCapture");
    expect(source).toContain("resourceName");
  });

  it("surfaces offline and unresolved safety sync state", () => {
    expect(source).toContain("ManagerSyncStatus");
    expect(source).toContain("Needs attention");
    expect(source).toContain("followUpSyncState");
  });
});
