import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  renderFollowUpsPdf,
  renderProfileSummaryPdf,
} from "./google-drive-backup-pdf";
import type {
  FollowUpBackupSnapshot,
  ProfileBackupSnapshot,
} from "./google-drive-backup-types";

const generatedAt = new Date("2026-09-09T14:00:00.000Z");

describe("Google Drive backup PDFs", () => {
  it("renders a deterministic profile summary without full email bodies", async () => {
    const snapshot: ProfileBackupSnapshot = {
      profileId: "org-1",
      displayName: "Café County Fair",
      contactDetails: [
        { label: "Phone", value: "307-555-0100" },
        { label: "Email", value: "fair@example.com" },
      ],
      bookings: [{
        id: "booking-1",
        name: "County Fair 2027",
        status: "new_lead",
        startsAt: "2027-07-01T16:00:00.000Z",
        location: "Boulder, CO",
      }],
      recentActivity: Array.from({ length: 80 }, (_, index) => ({
        id: `activity-${index}`,
        kind: "note",
        title: `Activity ${index} ${"long summary ".repeat(8)}`,
        occurredAt: generatedAt.toISOString(),
      })),
      emailSummaries: [{
        messageId: "message-1",
        occurredAt: generatedAt.toISOString(),
        sender: "organizer@example.com",
        subject: "Next season",
        summary: "A short approved Gmail snippet.",
        appUrl: "https://command.example/organizations/org-1",
      }],
      appUrl: "https://command.example/organizations/org-1",
      generatedAt,
      sourceVersion: generatedAt.toISOString(),
    };

    const bytes = await renderProfileSummaryPdf(snapshot);
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getTitle()).toBe("Profile Summary — Café County Fair");
    expect(pdf.getCreationDate()?.toISOString()).toBe(generatedAt.toISOString());
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(Buffer.from(bytes).toString("latin1")).not.toContain(
      "FULL-EMAIL-BODY-MUST-NOT-LEAK",
    );
  });

  it("renders due, scheduled, and completed follow-up sections", async () => {
    const snapshot: FollowUpBackupSnapshot = {
      profileId: "org-1",
      displayName: "County Fair",
      open: [{
        id: "due",
        kind: "email",
        dueAt: "2026-09-08T12:00:00.000Z",
        completedAt: null,
        outcome: null,
        bookingName: "County Fair",
      }],
      scheduled: [{
        id: "future",
        kind: "call",
        dueAt: "2026-10-01T12:00:00.000Z",
        completedAt: null,
        outcome: null,
        bookingName: null,
      }],
      completedRecent: [{
        id: "done",
        kind: "email",
        dueAt: "2026-09-01T12:00:00.000Z",
        completedAt: "2026-09-02T12:00:00.000Z",
        outcome: "Replied",
        bookingName: "County Fair",
      }],
      appUrl: "https://command.example/organizations/org-1",
      generatedAt,
      sourceVersion: generatedAt.toISOString(),
    };

    const bytes = await renderFollowUpsPdf(snapshot);
    const pdf = await PDFDocument.load(bytes);

    expect(pdf.getTitle()).toBe("Follow-ups — County Fair");
    expect(pdf.getPageCount()).toBe(1);
    expect(bytes.byteLength).toBeGreaterThan(500);
  });
});
