import { describe, expect, it } from "vitest";

import { APPROVED_LEAD_INTRODUCTION_2026 } from "../communication-templates/lead-introduction-2026-approved";
import { LeadAvailabilityService, type LeadAvailabilitySnapshot } from "./lead-availability-service";
import { buildLeadEmailPreview, type LeadEmailPreviewLead } from "./lead-email-preview-service";

const now = new Date("2026-08-26T12:00:00.000Z");

function lead(reviewVersion: number): LeadEmailPreviewLead {
  return {
    rowId: "30000000-0000-4000-8000-000000000001",
    reviewVersion,
    organizationId: "10000000-0000-4000-8000-000000000001",
    contactId: "20000000-0000-4000-8000-000000000001",
    profileName: "Aspen Filmfest",
    eventName: "Aspen Filmfest",
    eventCity: "Aspen",
    eventRegion: "CO",
    startDate: "2026-09-29",
    endDate: "2026-10-04",
    firstName: "Avery",
    recipientEmail: "person@example.com",
    rowState: "verified",
    recipientConfirmed: true,
    introductionSuitable: true,
    relationshipOutcome: "new_introduction",
    territoryStatus: "open",
    fitStatus: "approved",
  };
}

const approvedTemplate = {
  templateId: "40000000-0000-4000-8000-000000000001",
  code: APPROVED_LEAD_INTRODUCTION_2026.code,
  version: APPROVED_LEAD_INTRODUCTION_2026.version,
  sourceDocumentId: "50000000-0000-4000-8000-000000000001",
  sourceFilename: APPROVED_LEAD_INTRODUCTION_2026.sourceFilename,
  reviewedBy: APPROVED_LEAD_INTRODUCTION_2026.reviewedBy,
  reviewedAt: "2026-08-26T00:00:00.000Z",
  definition: APPROVED_LEAD_INTRODUCTION_2026,
};

async function task6Snapshot(events: any[] = []) {
  let saved: LeadAvailabilitySnapshot | undefined;
  const service = new LeadAvailabilityService({
    persistence: {
      loadVerifiedLead: async () => ({
        id: lead(4).rowId,
        reviewVersion: 4,
        state: "verified",
        organizationId: lead(4).organizationId,
        recipientEmail: lead(4).recipientEmail,
        recipientConfirmed: true,
        introductionSuitable: true,
        startDate: lead(4).startDate,
        endDate: lead(4).endDate,
      }),
      selectedCalendars: async () => [
        { id: "calendar-a", summary: "Calendar A", primary: true },
        { id: "calendar-b", summary: "Calendar B", primary: false },
      ],
      packageAvailabilityTemplates: async () => [{
        code: "adventure_zone",
        name: "Adventure Zone",
        normalCapacity: 2,
        temporaryUnavailableQuantity: 0,
      }],
      save: async (snapshot) => {
        saved = snapshot;
        return { reviewVersion: snapshot.expectedVersion + 1 };
      },
    },
    google: { listCalendarEvents: async () => events },
    now: () => now,
  });
  const result = await service.check({ rowId: lead(4).rowId, expectedVersion: 4, checkedBy: "owner" });
  if (!saved) throw new Error("Task 6 did not persist a snapshot");
  return { saved, result };
}

function previewAvailability(saved: LeadAvailabilitySnapshot, reviewVersion: number) {
  return {
    ready: saved.ready,
    checkedAt: saved.checkedAt,
    reviewVersion,
    proposedStartDate: saved.proposedWindow.startDate,
    proposedEndDate: saved.proposedWindow.endDate,
    packageAvailability: saved.packageAvailability,
  };
}

describe("Task 6 to Task 7 snapshot contract", () => {
  it("accepts the current Task 6 buffered booking window", async () => {
    const { saved, result } = await task6Snapshot();
    const preview = buildLeadEmailPreview({
      lead: lead(result.reviewVersion),
      blocks: [],
      availability: previewAvailability(saved, result.reviewVersion),
      approvedTemplate,
      now,
      calendarEvidence: saved.sourceEvents,
      calendarReservations: saved.reservations,
    });

    expect(saved.proposedWindow).toEqual({ startDate: "2026-09-27", endDate: "2026-10-05" });
    expect(preview.readiness).toEqual({ ready: true, blockers: [] });
    expect(preview.subject).toContain("Aspen Filmfest");
    expect(preview.body).toContain("Our Adventure Zone units feature");
  });

  it("rejects a Task 6 snapshot after confirmed dates change", async () => {
    const { saved, result } = await task6Snapshot();
    const preview = buildLeadEmailPreview({
      lead: { ...lead(result.reviewVersion), startDate: "2026-09-30" },
      blocks: [],
      availability: previewAvailability(saved, result.reviewVersion),
      approvedTemplate,
      now,
      calendarReservations: saved.reservations,
    });

    expect(preview.readiness.blockers).toContain("availability_stale_for_lead_version");
    expect(preview.body).toBeNull();
  });

  it("rejects a Task 6 snapshot after the lead version changes", async () => {
    const { saved, result } = await task6Snapshot();
    const preview = buildLeadEmailPreview({
      lead: lead(result.reviewVersion + 1),
      blocks: [],
      availability: previewAvailability(saved, result.reviewVersion),
      approvedTemplate,
      now,
      calendarReservations: saved.reservations,
    });

    expect(preview.readiness.blockers).toContain("availability_stale_for_lead_version");
    expect(preview.body).toBeNull();
  });
});

describe("Calendar conflict summary", () => {
  it("independently blocks an aggregate ambiguous reservation even when persisted ready is true", () => {
    const preview = buildLeadEmailPreview({
      lead: lead(5),
      blocks: [],
      availability: {
        ready: true,
        checkedAt: now.toISOString(),
        reviewVersion: 5,
        proposedStartDate: "2026-09-27",
        proposedEndDate: "2026-10-05",
        packageAvailability: {
          status: "resolved",
          packages: [{ packageKey: "adventure_zone", availableQuantity: 1 }],
          restrictedOptions: [],
        },
      },
      approvedTemplate,
      now,
      calendarReservations: [{ confidence: "ambiguous", packageKey: null }],
    });

    expect(preview.readiness).toEqual({
      ready: false,
      blockers: expect.arrayContaining(["availability_ambiguous"]),
    });
    expect(preview.subject).toBeNull();
    expect(preview.body).toBeNull();
    expect(preview.calendarConflictSummary.totalConflicts).toBe(1);
  });

  it("reports a grouped duplicate-instance disagreement that blocks Task 6 readiness", async () => {
    const event = {
      calendarTimeZone: "America/Chicago",
      iCalUid: "shared-instance@example.com",
      recurringEventId: "series-1",
      originalStartTime: { date: "2026-09-29" },
      start: { date: "2026-09-29" },
      end: { date: "2026-10-01" },
      updated: "2026-08-25T10:00:00.000Z",
      description: "",
    };
    const { saved, result } = await task6Snapshot([
      { ...event, calendarId: "calendar-a", id: "event-a", summary: "1 Adventure Zone" },
      { ...event, calendarId: "calendar-b", id: "event-b", summary: "2 Adventure Zone" },
    ]);
    const preview = buildLeadEmailPreview({
      lead: lead(result.reviewVersion),
      blocks: [],
      availability: previewAvailability(saved, result.reviewVersion),
      approvedTemplate,
      now,
      calendarEvidence: saved.sourceEvents,
      calendarReservations: saved.reservations,
    });

    expect(saved.reservations).toHaveLength(1);
    expect(saved.reservations[0]?.confidence).toBe("ambiguous");
    expect(saved.sourceEvents.every((item: any) => item.classification?.confidence === "explicit")).toBe(true);
    expect(preview.readiness.ready).toBe(false);
    expect(preview.readiness.blockers).toContain("availability_not_ready");
    expect(preview.calendarConflictSummary.totalConflicts).toBe(1);
  });

  it("reports the total sanitized evidence count when the bounded projection is truncated", () => {
    const evidence = Array.from({ length: 21 }, (_, index) => ({
      calendarId: `calendar-${index}`,
      eventId: `event-${index}`,
      classification: { confidence: "explicit" },
    }));
    const preview = buildLeadEmailPreview({
      lead: lead(5),
      blocks: [],
      availability: {
        ready: true,
        checkedAt: now.toISOString(),
        reviewVersion: 5,
        proposedStartDate: "2026-09-27",
        proposedEndDate: "2026-10-05",
        packageAvailability: {
          status: "resolved",
          packages: [{ packageKey: "adventure_zone", availableQuantity: 1 }],
          restrictedOptions: [],
        },
      },
      approvedTemplate,
      now,
      calendarEvidence: evidence,
      calendarReservations: [],
    });

    expect(preview.calendarEvidence).toHaveLength(20);
    expect(preview.calendarConflictSummary).toEqual({
      totalConflicts: 0,
      totalEvidenceRecords: 21,
      displayedEvidenceRecords: 20,
      truncated: true,
    });
  });
});
