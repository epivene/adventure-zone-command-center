import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const receipts = readFileSync("src/pages/ManagerReceiptsPage.tsx", "utf8");
const incidents = readFileSync("src/pages/ManagerIncidentsPage.tsx", "utf8");
const incidentForm = readFileSync("src/pages/ManagerIncidentPage.tsx", "utf8");
const syncStatus = readFileSync("src/components/manager/manager-sync-status.tsx", "utf8");

describe("manager saved record review", () => {
  it("shows receipt photos and edit/delete/replace actions", () => {
    expect(receipts).toContain("Open photo");
    expect(receipts).toContain("Replace photo");
    expect(receipts).toContain("Edit expense");
    expect(receipts).toContain("Delete expense");
  });

  it("shows incident photos and edit/delete actions", () => {
    expect(incidents).toContain("Open photo");
    expect(incidents).toContain("Edit incident");
    expect(incidents).toContain("Delete incident");
    expect(incidents).toContain("Photo upload failed");
  });

  it("gives a strong confirmation after incident save and shared manager saves", () => {
    expect(incidentForm).toContain("Incident saved and synced");
    expect(incidentForm).toContain("View incidents");
    expect(syncStatus).toContain("Saved and synced");
    expect(syncStatus).toContain("Saved offline — will sync automatically");
  });
});
