/**
 * Calendar route tests.
 *
 * Covers:
 * - isCalendarEligibleRow: only calendar / act_activity records qualify
 * - mapActivityRow: field mapping and displaySubject derivation
 * - getActCalendarActivities: full filter+map pipeline via injected mock DB
 * - GET /calendar HTTP: returns mixed booking + act activity items; notes/history excluded
 */

import express from "express";
import request from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Hoisted state ─────────────────────────────────────────────────────────────
// The DB mock reads from activityStore at call time so individual tests can
// control which rows are "returned" by the database.
const activityStore = vi.hoisted(() => ({ rows: [] as ActivityQueryRow[] }));

// ─── Global mocks (hoisted by Vitest before imports) ──────────────────────────

vi.mock("@/db/client", () => ({
  db: {
    select: () => ({
      from: function () {
        return this;
      },
      leftJoin: function () {
        return this;
      },
      where: () => Promise.resolve(activityStore.rows),
    }),
  },
}));

vi.mock("@/features/routes/map-query", () => ({
  getMapEvents: vi.fn(async () => []),
}));

// ─── Imports (after mocks are registered) ─────────────────────────────────────

import {
  isCalendarEligibleRow,
  mapActivityRow,
  getActCalendarActivities,
  type ActivityQueryRow,
} from "./calendar";
import { getMapEvents } from "@/features/routes/map-query";
import type { MapEvent } from "@/features/routes/map-data";

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function makeBookingEvent(id: string): MapEvent {
  return {
    id,
    name: "Test Booking",
    city: "Denver",
    region: "CO",
    latitude: null,
    longitude: null,
    status: "confirmed",
    probability: "likely",
    travelLegId: null,
    travelLegName: null,
    travelLegColor: null,
    startsAt: new Date("2026-07-01"),
    endsAt: null,
  };
}

// ─── isCalendarEligibleRow ────────────────────────────────────────────────────

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

// ─── mapActivityRow ───────────────────────────────────────────────────────────

describe("mapActivityRow", () => {
  it("uses explicit subject column when set", () => {
    const row = makeRow({ subject: "My meeting" });
    expect(mapActivityRow(row).displaySubject).toBe("My meeting");
  });

  it("falls back to first line of body when subject is null", () => {
    const row = makeRow({ subject: null, body: "First line\n\nRest of body" });
    expect(mapActivityRow(row).displaySubject).toBe("First line");
  });

  it("maps kind=calendar to activityType Activity", () => {
    expect(mapActivityRow(makeRow({ kind: "calendar", actRecordId: null })).activityType).toBe(
      "Activity",
    );
  });

  it("maps act_activity: prefix to activityType Activity", () => {
    expect(mapActivityRow(makeRow({ actRecordId: "act_activity:123" })).activityType).toBe(
      "Activity",
    );
  });

  it("maps act_note: prefix to activityType Note", () => {
    expect(mapActivityRow(makeRow({ actRecordId: "act_note:123" })).activityType).toBe("Note");
  });

  it("assembles contactName from first+last", () => {
    expect(
      mapActivityRow(makeRow({ contactFirstName: "Jane", contactLastName: "Doe" })).contactName,
    ).toBe("Jane Doe");
  });

  it("returns null contactName when names are missing", () => {
    expect(
      mapActivityRow(makeRow({ contactFirstName: null, contactLastName: null })).contactName,
    ).toBeNull();
  });

  it("sets source to act_activity", () => {
    expect(mapActivityRow(makeRow()).source).toBe("act_activity");
  });
});

// ─── getActCalendarActivities (injected mock DB) ──────────────────────────────

describe("getActCalendarActivities", () => {
  function buildMockDb(rows: ActivityQueryRow[]) {
    return {
      select: () => ({
        from: function () {
          return this;
        },
        leftJoin: function () {
          return this;
        },
        where: () => Promise.resolve(rows),
      }),
    };
  }

  it("includes a reviewed replacement-import activity (kind=calendar)", async () => {
    const result = await getActCalendarActivities(
      buildMockDb([makeRow({ id: "cal-1", kind: "calendar", actRecordId: null })]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("cal-1");
    expect(result[0]!.activityType).toBe("Activity");
  });

  it("includes a legacy activity-stream record (act_activity: prefix)", async () => {
    const result = await getActCalendarActivities(
      buildMockDb([
        makeRow({ id: "act-1", kind: "act_history", actRecordId: "act_activity:xyz" }),
      ]),
    );
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("act-1");
  });

  it("excludes note entries (act_note: prefix)", async () => {
    const result = await getActCalendarActivities(
      buildMockDb([makeRow({ id: "note-1", kind: "act_history", actRecordId: "act_note:abc" })]),
    );
    expect(result).toHaveLength(0);
  });

  it("excludes history text entries (act_history: prefix)", async () => {
    const result = await getActCalendarActivities(
      buildMockDb([
        makeRow({ id: "hist-1", kind: "act_history", actRecordId: "act_history:abc" }),
      ]),
    );
    expect(result).toHaveLength(0);
  });

  it("filters mixed rows — only calendar-eligible ones survive", async () => {
    const rows: ActivityQueryRow[] = [
      makeRow({ id: "keep-cal", kind: "calendar", actRecordId: null }),
      makeRow({ id: "keep-act", kind: "act_history", actRecordId: "act_activity:1" }),
      makeRow({ id: "drop-note", kind: "act_history", actRecordId: "act_note:2" }),
      makeRow({ id: "drop-hist", kind: "act_history", actRecordId: "act_history:3" }),
    ];
    const result = await getActCalendarActivities(buildMockDb(rows));
    const ids = result.map((r) => r.id);
    expect(ids).toContain("keep-cal");
    expect(ids).toContain("keep-act");
    expect(ids).not.toContain("drop-note");
    expect(ids).not.toContain("drop-hist");
  });
});

// ─── GET /calendar HTTP route ─────────────────────────────────────────────────

describe("GET /calendar", () => {
  let app: ReturnType<typeof express>;

  beforeAll(async () => {
    const { default: router } = await import("./calendar");
    app = express();
    app.use(express.json());
    app.use("/api", router);
  });

  beforeEach(() => {
    activityStore.rows = [];
    vi.mocked(getMapEvents).mockReset();
    vi.mocked(getMapEvents).mockResolvedValue([]);
  });

  it("returns both booking and Act! activity items in one response", async () => {
    activityStore.rows = [makeRow({ id: "act-1", kind: "calendar", actRecordId: null })];
    vi.mocked(getMapEvents).mockResolvedValue([makeBookingEvent("bk-1")]);

    const res = await request(app).get("/api/calendar");

    expect(res.status).toBe(200);
    const items: Array<{ source: string; id: string }> = res.body;
    expect(items.find((i) => i.source === "booking" && i.id === "bk-1")).toBeDefined();
    expect(items.find((i) => i.source === "act_activity" && i.id === "act-1")).toBeDefined();
  });

  it("excludes note/history rows via JS-level filter even when DB returns them", async () => {
    activityStore.rows = [
      makeRow({ id: "drop-note", kind: "act_history", actRecordId: "act_note:n1" }),
      makeRow({ id: "drop-hist", kind: "act_history", actRecordId: "act_history:h1" }),
      makeRow({ id: "keep-act", kind: "act_history", actRecordId: "act_activity:a1" }),
    ];

    const res = await request(app).get("/api/calendar");

    expect(res.status).toBe(200);
    const actItems = (res.body as Array<{ source: string; id: string }>).filter(
      (i) => i.source === "act_activity",
    );
    expect(actItems).toHaveLength(1);
    expect(actItems[0]!.id).toBe("keep-act");
  });

  it("returns 200 with empty array when there are no bookings or activities", async () => {
    const res = await request(app).get("/api/calendar");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("passes dateFrom and dateTo to getMapEvents when from/to params are provided", async () => {
    await request(app).get("/api/calendar?from=2026-01-01&to=2026-07-31");
    expect(vi.mocked(getMapEvents)).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: "2026-01-01", dateTo: "2026-07-31" }),
    );
  });

  it("passes dateFrom: null and dateTo: null to getMapEvents when no params given", async () => {
    await request(app).get("/api/calendar");
    expect(vi.mocked(getMapEvents)).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: null, dateTo: null }),
    );
  });

  it("filters out bookings whose startsAt falls outside the requested window", async () => {
    // Return a mix of in-window and out-of-window booking events from the mock.
    vi.mocked(getMapEvents).mockImplementation(async (filters) => {
      const { filterMapEvents } = await import("@/features/routes/map-data");
      const all: import("@/features/routes/map-data").MapEvent[] = [
        { ...makeBookingEvent("inside"), startsAt: new Date("2026-06-15T00:00:00Z") },
        { ...makeBookingEvent("outside-before"), startsAt: new Date("2025-11-01T00:00:00Z") },
        { ...makeBookingEvent("outside-after"), startsAt: new Date("2027-03-01T00:00:00Z") },
      ];
      return filterMapEvents(all, filters);
    });

    const res = await request(app).get("/api/calendar?from=2026-01-01&to=2026-12-31");

    expect(res.status).toBe(200);
    const ids = (res.body as Array<{ id: string }>).map((i) => i.id);
    expect(ids).toContain("inside");
    expect(ids).not.toContain("outside-before");
    expect(ids).not.toContain("outside-after");
  });

  it("ignores malformed from/to params and returns all bookings", async () => {
    vi.mocked(getMapEvents).mockResolvedValue([makeBookingEvent("bk-any")]);
    const res = await request(app).get("/api/calendar?from=not-a-date&to=also-bad");
    expect(res.status).toBe(200);
    // getMapEvents should have been called with null bounds
    expect(vi.mocked(getMapEvents)).toHaveBeenCalledWith(
      expect.objectContaining({ dateFrom: null, dateTo: null }),
    );
  });
});
