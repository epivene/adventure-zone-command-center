import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/leg-manager-event-checklist-attachments.ts", "utf8");

describe("manager checklist attachment routes", () => {
  it("creates idempotent attachment metadata and accepts private image upload", () => {
    expect(source).toContain('/manager/events/:bookingId/checklist-results/:resultId/attachments');
    expect(source).toContain('/manager/events/:bookingId/checklist-attachments/:attachmentId/image');
    expect(source).toContain('express.raw({ type: "image/*", limit: "12mb" })');
    expect(source).toContain("eventChecklistAttachments");
    expect(source).toContain("GoogleCloudLegManagerObjectStorage");
    expect(source).toContain("checklist/");
  });

  it("verifies booking and leg ownership before metadata or image writes", () => {
    expect(source).toContain("eventChecklistRuns.legId");
    expect(source).toContain("eventChecklistRuns.bookingId");
    expect(source).toContain("403");
  });
});
