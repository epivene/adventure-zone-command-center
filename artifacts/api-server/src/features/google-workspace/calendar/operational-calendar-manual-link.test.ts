import { describe, expect, it, vi } from "vitest";
vi.mock("@/features/outreach-planner/outreach-commitments", () => ({
  reconcileCapacityFacts: (db: unknown, _reason: string, work: (tx: unknown) => unknown) => work(db),
}));
vi.mock("./operational-calendar-matcher", () => ({ parseOperationalEventDateText: () => null }));
vi.mock("@/db/schema", () => {
  const table = (id: string) => ({ id, name: id + ".name", city: id + ".city", region: id + ".region", state: id + ".state", bookingId: id + ".bookingId", connectionId: id + ".connectionId", calendarId: id + ".calendarId", packageKey: id + ".packageKey" });
  return Object.fromEntries(["bookings", "organizations", "packageTemplates", "travelLegs", "bookingOperationalWindows", "bookingPackageSelections", "googleOperationalCalendarLinks", "googleOperationalCalendarReviews"].map(name => [name, table(name)]));
});
import { OperationalCalendarLinkRepository } from "./operational-calendar-link-repository";
import { bookings, organizations, googleOperationalCalendarLinks, googleOperationalCalendarReviews } from "@/db/schema";

function database(options: { conflict?: boolean; missing?: boolean; cancelled?: boolean; noPackage?: boolean } = {}) {
  const review = {
    id: "review", state: "pending", connectionId: "connection", calendarId: "calendar", googleEventId: "event",
    proposedChanges: {
      candidateBookingIds: ["different-booking"],
      parsed: { packageKey: options.noPackage ? null : "zone", calendarState: options.cancelled ? "cancelled" : "confirmed" },
      google: { summary: options.cancelled ? "CANCELLED Festival" : "Festival", startDate: "2026-09-10", endDateExclusive: "2026-09-14" },
    },
  };
  const writes: unknown[] = [];
  const tx: any = {
    select: () => {
      let rows: unknown[] = [];
      const chain: any = {
        from: (table: unknown) => {
          rows = table === googleOperationalCalendarReviews ? [review]
            : table === bookings ? options.missing ? [] : [{ id: "chosen-booking", organizationId: "profile", status: "cancelled", notes: "Keep me" }]
            : table === googleOperationalCalendarLinks && options.conflict ? [{ googleEventId: "other-event" }] : [];
          return chain;
        },
        where: () => chain, limit: () => chain, for: () => chain,
        then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return chain;
    },
    insert: (table: unknown) => { writes.push(table); return { values: () => ({ onConflictDoUpdate: async () => {} }) }; },
    update: (table: unknown) => { writes.push(table); return { set: () => ({ where: async () => {} }) }; },
    execute: vi.fn(),
  };
  return { tx, writes };
}
describe("manual calendar linking", () => {
  it("accepts an existing booking outside automatic candidates without rewriting CRM facts", async () => {
    const { tx, writes } = database({ cancelled: true });
    const result = await new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "link_existing", bookingId: "chosen-booking", reviewedBy: "owner" });
    expect(result.bookingId).toBe("chosen-booking");
    expect(result.created).toBe(false);
    expect(writes).toEqual([googleOperationalCalendarLinks, googleOperationalCalendarReviews]);
    expect(writes).not.toContain(bookings);
    expect(writes).not.toContain(organizations);
    expect(tx.execute).not.toHaveBeenCalled();
  });
  it("allows an explicit package for an unclassified calendar row", async () => {
    const { tx } = database({ noPackage: true });
    await expect(new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "link_existing", bookingId: "chosen-booking", packageKey: "zone", reviewedBy: "owner" })).resolves.toMatchObject({ created: false });
  });
  it.each([
    [{ missing: true }, "GOOGLE_OPERATIONAL_CALENDAR_BOOKING_NOT_FOUND"],
    [{ conflict: true }, "GOOGLE_OPERATIONAL_CALENDAR_BOOKING_ALREADY_LINKED"],
  ])("rejects invalid links before writing", async (options, error) => {
    const { tx, writes } = database(options);
    await expect(new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "link_existing", bookingId: "chosen-booking", reviewedBy: "owner" })).rejects.toThrow(error);
    expect(writes).toEqual([]);
  });
  it("does not create a confirmed profile from a canceled event", async () => {
    const { tx, writes } = database({ cancelled: true });
    await expect(new OperationalCalendarLinkRepository(tx).resolveReview({ reviewId: "review", resolution: "create_new", reviewedBy: "owner" })).rejects.toThrow("GOOGLE_OPERATIONAL_CALENDAR_CANCELLED_CREATE_BLOCKED");
    expect(writes).toEqual([]);
  });
});
