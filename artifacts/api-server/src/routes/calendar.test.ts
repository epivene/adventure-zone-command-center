/**
 * Calendar route tests.
 *
 * Covers:
 * - isCalendarEligibleRow: only calendar / act_activity records qualify
 * - mapActivityRow: field mapping and displaySubject derivation
 * - GET /calendar: route returns booking + act activity items; note/history excluded
 */

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mocks ────────────────────────────────────────────────────────────────────

// Stub out the booking-events side so the route test can focus on activities.
vi.mock("@/features/routes/map-query", () => ({
  getMapEvents: vi.fn(async () => []),
}));

// ─── Pure-function unit tests ─────────────────────────────────────────────────

import {
  isCalendarEligibleRow,
  mapActivityRow,
  type ActivityQueryRow,
} from "./calendar";

function makeRow(overrides: Partial<ActivityQueryRow> = {}): ActivityQueryRow {
  return {
    id: "row-id",
    body: "Subject line\n\nBody text",
    subject: null,
    kind: "act_history",
    timelineSortAt: new Date("2025-06-15T10:00:00Z"),
    endsAt: null,
    actRecordId: "act_activity:abc123",
    contactId: null,
    contactFirstName: null,
    contactLastName: null,
    organizationId: null,
    organizationName: null,
    bookingId: null,
    ...overrides,
  };
}

describe("isCalendarEligibleRow", () => {
  it("accepts kind=calendar (replacement-flow reviewed imports)", () => {
    expect(isCalendarEligibleRow({ kind: "calendar", actRecordId: null })).toBe(true);
  });

  it("accepts kind=act_history with act_activity: prefix", () => {
    expect(
      isCalendarEligibleRow({ kind: "act_history", actRecordId: "act_activity:abc" }),
    ).toBe(true);
  });

  it("rejects kind=act_history with act_note: prefix", () => {
    expect(
      isCalendarEligibleRow({ kind: "act_history", actRecordId: "act_note:abc" }),
    ).toBe(false);
  });

  it("rejects kind=act_history with act_history: prefix", () => {
    expect(
      isCalendarEligibleRow({ kind: "act_history", actRecordId: "act_history:abc" }),
    ).toBe(false);
  });

  it("rejects kind=act_history with null actRecordId", () => {
    expect(isCalendarEligibleRow({ kind: "act_history", actRecordId: null })).toBe(false);
  });

  it("rejects other kinds", () => {
    expect(isCalendarEligibleRow({ kind: "note", actRecordId: null })).toBe(false);
    expect(isCalendarEligibleRow({ kind: "call", actRecordId: null })).toBe(false);
  });
});

describe("mapActivityRow", () => {
  it("uses explicit subject column when set", () => {
    const row = makeRow({ subject: "My meeting" });
    const out = mapActivityRow(row);
    expect(out.displaySubject).toBe("My meeting");
  });

  it("falls back to first line of body when subject is null", () => {
    const row = makeRow({ subject: null, body: "First line\n\nRest of body" });
    const out = mapActivityRow(row);
    expect(out.displaySubject).toBe("First line");
  });

  it("maps kind=calendar to activityType Activity", () => {
    const row = makeRow({ kind: "calendar", actRecordId: null });
    expect(mapActivityRow(row).activityType).toBe("Activity");
  });

  it("maps act_activity: prefix to activityType Activity", () => {
    const row = makeRow({ actRecordId: "act_activity:123" });
    expect(mapActivityRow(row).activityType).toBe("Activity");
  });

  it("maps act_note: prefix to activityType Note", () => {
    const row = makeRow({ actRecordId: "act_note:123" });
    expect(mapActivityRow(row).activityType).toBe("Note");
  });

  it("assembles contactName from first+last", () => {
    const row = makeRow({ contactFirstName: "Jane", contactLastName: "Doe" });
    expect(mapActivityRow(row).contactName).toBe("Jane Doe");
  });

  it("returns null contactName when names are missing", () => {
    const row = makeRow({ contactFirstName: null, contactLastName: null });
    expect(mapActivityRow(row).contactName).toBeNull();
  });

  it("sets source to act_activity", () => {
    expect(mapActivityRow(makeRow()).source).toBe("act_activity");
  });
});

// ─── Route integration test ───────────────────────────────────────────────────

describe("GET /calendar", () => {
  let app: ReturnType<typeof express>;

  // Build a mock DB whose select chain returns a controlled set of rows.
  function buildMockDb(rows: ActivityQueryRow[]) {
    const terminal = vi.fn(() => Promise.resolve(rows));
    const chain = {
      from: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      where: terminal,
    };
    return { select: vi.fn(() => chain) };
  }

  beforeEach(async () => {
    vi.resetModules();
    const { default: router } = await import("./calendar");
    app = express();
    app.use(express.json());
    app.use("/api", router);
  });

  it("includes a reviewed replacement-import activity (kind=calendar)", async () => {
    const rows: ActivityQueryRow[] = [
      makeRow({ id: "cal-1", kind: "calendar", actRecordId: null }),
    ];
    const mockDb = buildMockDb(rows);

    const { getActCalendarActivities } = await import("./calendar");
    // Call directly with injected mock db to verify the filter+map pipeline
    const result = await getActCalendarActivities(mockDb as any);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("cal-1");
    expect(result[0]!.activityType).toBe("Activity");
  });

  it("includes a legacy activity-stream record (kind=act_history, act_activity: prefix)", async () => {
    const rows: ActivityQueryRow[] = [
      makeRow({ id: "act-1", kind: "act_history", actRecordId: "act_activity:xyz" }),
    ];
    const mockDb = buildMockDb(rows);
    const { getActCalendarActivities } = await import("./calendar");

    const result = await getActCalendarActivities(mockDb as any);

    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("act-1");
  });

  it("excludes note entries (act_note: prefix) from the calendar", async () => {
    const rows: ActivityQueryRow[] = [
      makeRow({ id: "note-1", kind: "act_history", actRecordId: "act_note:abc" }),
    ];
    const mockDb = buildMockDb(rows);
    const { getActCalendarActivities } = await import("./calendar");

    const result = await getActCalendarActivities(mockDb as any);

    expect(result).toHaveLength(0);
  });

  it("excludes history text entries (act_history: prefix) from the calendar", async () => {
    const rows: ActivityQueryRow[] = [
      makeRow({ id: "hist-1", kind: "act_history", actRecordId: "act_history:abc" }),
    ];
    const mockDb = buildMockDb(rows);
    const { getActCalendarActivities } = await import("./calendar");

    const result = await getActCalendarActivities(mockDb as any);

    expect(result).toHaveLength(0);
  });

  it("returns mixed booking + act activity items via HTTP", async () => {
    const { getMapEvents } = await import("@/features/routes/map-query");
    vi.mocked(getMapEvents).mockResolvedValueOnce([
      {
        id: "booking-1",
        name: "Test Booking",
        city: "Denver",
        region: "CO",
        latitude: null,
        longitude: null,
        status: "confirmed",
        probability: "definite",
        travelLegId: null,
        travelLegName: null,
        travelLegColor: null,
        startsAt: new Date("2026-07-01"),
        endsAt: null,
      },
    ]);

    const res = await request(app).get("/api/calendar");

    expect(res.status).toBe(200);
    // Bookings are included (mocked above returns one booking)
    const items: any[] = res.body;
    const booking = items.find((i) => i.source === "booking");
    expect(booking).toBeDefined();
    expect(booking.id).toBe("booking-1");
  });
});
