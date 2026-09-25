import { it, expect, vi } from "vitest";
import { createOperationsReads } from "./operations-reads";
import { emptySelection } from "./contracts";
const context: any = {
  actor: { id: "owner", role: "owner" },
  selection: {
    ...emptySelection(),
    organizationIds: ["profile"],
    eventYear: 2027,
  },
  signal: new AbortController().signal,
};
const ports = (): any => ({
  legs: async () => [{ id: "leg", name: "North", archivedAt: null }],
  events: async () => [
    {
      id: "current",
      travelLegId: "leg",
      seasonYear: 2027,
      travelLegAssignmentKind: "suggested",
      legAssignmentWarning: "long_travel",
      startsAt: "2027-07-01",
      endsAt: "2027-07-02",
    },
    { id: "old", travelLegId: "leg", seasonYear: 2026 },
    {
      id: "undated",
      travelLegId: "leg",
      seasonYear: null,
      startsAt: null,
      endsAt: null,
    },
  ],
  resources: async () => [],
  legResources: async () => [],
  inspection: async () => ({
    id: "inspection",
    legId: "leg",
    inspectionYear: 2026,
    status: "draft",
    updatedAt: "2026-12-01",
    entries: [
      {
        id: "entry",
        pieceId: "piece",
        entryState: "not_present",
        repairNeeded: true,
        maintenanceItem: {
          id: "m",
          state: "resolved",
          resolutionNotes: "Repaired",
        },
        photos: [{ storageKey: "secret" }],
      },
    ],
    storageKey: "secret",
  }),
  pieces: async () => [
    {
      id: "piece",
      name: "Castle",
      currentLegId: "leg",
      lifecycleStatus: "stored",
      storageKey: "secret",
    },
  ],
  tasks: async () => [
    {
      id: "task",
      officeAccountId: "account",
      title: "Verify contact",
      organizationId: "profile",
      coordinatorNote: "Call tomorrow",
      passwordHash: "secret",
    },
  ],
  booking: () => ({
    getForBooking: vi.fn(async () => ({
      warnings: [{ message: "Overridden: owner review", severity: "warning" }],
    })),
  }),
});
it("keeps suggested routes, undated warnings and requested season separate from prior years", async () => {
  const reads = createOperationsReads(
    null,
    { query: async () => ({ rows: [] }) },
    ports(),
  );
  const r: any = await reads.read_route_context(context, {
    legId: "leg",
    eventYear: 2027,
  });
  expect(r.data.events.map((e: any) => e.id)).toEqual(["current", "undated"]);
  expect(r.data.events[0].travelLegAssignmentKind).toBe("suggested");
  expect(r.data.warnings.join(" ")).toContain("missing dates");
  await expect(
    reads.read_route_context(context, { legId: "leg", eventYear: 2026 }),
  ).rejects.toThrow("ASSISTANT_EVENT_YEAR_MISMATCH");
});
it("keeps inspection snapshots separate from current inventory and removes photo storage/account secrets", async () => {
  const reads = createOperationsReads(
    null,
    {
      query: async () => ({
        rows: [
          {
            id: "account",
            display_name: "Coordinator",
            role: "office_coordinator",
            enabled: true,
            updated_at: "2026-09-24",
            password_hash: "secret",
          },
        ],
      }),
    },
    ports(),
  );
  const r: any = await reads.read_inspection_context(context, {
    legId: "leg",
    inspectionYear: 2026,
  });
  expect(r.data.inspection.inspectionYear).toBe(2026);
  expect(r.data.inspectionYear).toBe(2026);
  expect(r.evidence[0].eventYear).toBeNull();
  expect(r.data.currentPieces[0].lifecycleStatus).toBe("stored");
  expect(r.data.inspection.entries[0].entryState).toBe("not_present");
  expect(JSON.stringify(r)).not.toContain("secret");
  expect(r.data.warnings.join(" ")).toContain("Photos");
  const staff: any = await reads.read_staff_work(context, { accountId: null });
  expect(staff.data.accounts[0].displayName).toBe("Coordinator");
  expect(JSON.stringify(staff)).not.toContain("secret");
});
it("rejects booking reads outside selected profile before loading operations", async () => {
  const p = ports(),
    reads = createOperationsReads(
      null,
      {
        query: async () => ({
          rows: [{ id: "booking", organization_id: "other", event_year: 2027 }],
        }),
      },
      p,
    );
  await expect(
    reads.read_booking_operations(context, {
      bookingId: "booking",
      eventYear: 2027,
    }),
  ).rejects.toThrow("ASSISTANT_TARGET_NOT_IN_BATCH");
});
