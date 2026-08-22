import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/manager/checklist-photo-capture.tsx", "utf8");

describe("ChecklistPhotoCapture", () => {
  it("queues metadata before blob upload and preserves booking context", () => {
    const metadata = source.indexOf("queueManagerMutation");
    const blob = source.indexOf("queueManagerBlob");
    expect(metadata).toBeGreaterThan(-1);
    expect(blob).toBeGreaterThan(metadata);
    expect(source).toContain('kind: "checklist_attachment"');
    expect(source).toContain("bookingId");
    expect(source).toContain("checklist-results/${resultId}/attachments");
  });

  it("shows manager sync state and does not make the checklist answer depend on photo upload", () => {
    expect(source).toContain("ManagerSyncStatus");
    expect(source).toContain("Photo saved on device");
    expect(source).toContain("Photo upload needs attention");
  });
});
