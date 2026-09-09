import { describe, expect, it, vi } from "vitest";

import { GoogleDriveBackupSnapshotRepository } from "./google-drive-backup-snapshot-repository";

describe("GoogleDriveBackupSnapshotRepository", () => {
  it("assembles a bounded profile snapshot without email bodies", async () => {
    const bodySentinel = "FULL-EMAIL-BODY-MUST-NOT-LEAK";
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM organizations o")) {
        return {
          rows: [{
            id: "org-1",
            name: "County Fair",
            phone: "307-555-0100",
            website: "https://fair.example",
            city: "Boulder",
            region: "CO",
            updated_at: new Date("2026-09-09T12:00:00.000Z"),
          }],
        };
      }
      if (text.includes("FROM contacts c")) {
        return {
          rows: [{
            id: "contact-1",
            first_name: "Sam",
            last_name: "Lee",
            email: "sam@fair.example",
            phone: "307-555-0101",
            job_title: "Director",
            updated_at: new Date("2026-09-09T12:01:00.000Z"),
          }],
        };
      }
      if (text.includes("FROM bookings b")) {
        return {
          rows: [{
            id: "booking-1",
            name: "County Fair 2027",
            status: "new_lead",
            starts_at: new Date("2027-07-01T16:00:00.000Z"),
            city: "Boulder",
            region: "CO",
            updated_at: new Date("2026-09-09T12:02:00.000Z"),
          }],
        };
      }
      if (text.includes("FROM activities a")) {
        return {
          rows: [{
            id: "activity-1",
            kind: "note",
            subject: "Called organizer",
            status: null,
            timeline_sort_at: new Date("2026-09-09T12:03:00.000Z"),
            updated_at: new Date("2026-09-09T12:03:00.000Z"),
          }],
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = new GoogleDriveBackupSnapshotRepository({
      pool: { query },
      appOrigin: "https://command.example",
      emailProvider: {
        listSummaries: async () => [{
          messageId: "message-1",
          occurredAt: "2026-09-09T11:00:00.000Z",
          sender: "sam@fair.example",
          subject: "Next year",
          summary: "Would like to discuss dates.",
          appUrl: "https://command.example/organizations/org-1",
        }],
      },
    });

    const snapshot = await repository.getProfileSnapshot(
      "org-1",
      new Date("2026-09-09T14:00:00.000Z"),
    );

    expect(snapshot).toMatchObject({
      profileId: "org-1",
      displayName: "County Fair",
      appUrl: "https://command.example/organizations/org-1",
      sourceVersion: "2026-09-09T12:03:00.000Z",
    });
    expect(snapshot?.contactDetails).toEqual(expect.arrayContaining([
      { label: "Phone", value: "307-555-0100" },
      { label: "Contact", value: "Sam Lee — Director" },
      { label: "Email", value: "sam@fair.example" },
    ]));
    expect(snapshot?.bookings).toHaveLength(1);
    expect(snapshot?.recentActivity).toEqual([{
      id: "activity-1",
      kind: "note",
      title: "Called organizer",
      occurredAt: "2026-09-09T12:03:00.000Z",
    }]);
    expect(JSON.stringify(snapshot)).not.toContain(bodySentinel);
    expect(query.mock.calls.find(([sql]) =>
      String(sql).includes("FROM activities a"),
    )?.[0]).not.toContain("a.body");
  });

  it("sorts follow-ups into open, scheduled, and recent completion buckets", async () => {
    const query = vi.fn(async (text: string) => {
      if (text.includes("FROM organizations o")) {
        return {
          rows: [{
            id: "org-1",
            name: "County Fair",
            updated_at: new Date("2026-09-09T12:00:00.000Z"),
          }],
        };
      }
      if (text.includes("FROM follow_ups f")) {
        return {
          rows: [
            {
              id: "due",
              kind: "email",
              due_at: new Date("2026-09-08T12:00:00.000Z"),
              completed_at: null,
              outcome: null,
              booking_name: "Fair",
              updated_at: new Date("2026-09-08T12:00:00.000Z"),
            },
            {
              id: "future",
              kind: "call",
              due_at: new Date("2026-10-01T12:00:00.000Z"),
              completed_at: null,
              outcome: null,
              booking_name: null,
              updated_at: new Date("2026-09-09T12:00:00.000Z"),
            },
            {
              id: "done",
              kind: "email",
              due_at: new Date("2026-09-01T12:00:00.000Z"),
              completed_at: new Date("2026-09-02T12:00:00.000Z"),
              outcome: "Replied",
              booking_name: "Fair",
              updated_at: new Date("2026-09-02T12:00:00.000Z"),
            },
          ],
        };
      }
      throw new Error(`Unexpected SQL: ${text}`);
    });
    const repository = new GoogleDriveBackupSnapshotRepository({
      pool: { query },
      appOrigin: "https://command.example",
    });

    const snapshot = await repository.getFollowUpSnapshot(
      "org-1",
      new Date("2026-09-09T14:00:00.000Z"),
    );

    expect(snapshot?.open.map((item) => item.id)).toEqual(["due"]);
    expect(snapshot?.scheduled.map((item) => item.id)).toEqual(["future"]);
    expect(snapshot?.completedRecent.map((item) => item.id)).toEqual(["done"]);
  });

  it("returns null after a source profile is removed", async () => {
    const repository = new GoogleDriveBackupSnapshotRepository({
      pool: { query: async () => ({ rows: [] }) },
      appOrigin: "https://command.example",
    });

    await expect(
      repository.getProfileSnapshot("missing", new Date()),
    ).resolves.toBeNull();
    await expect(
      repository.getFollowUpSnapshot("missing", new Date()),
    ).resolves.toBeNull();
  });
});
