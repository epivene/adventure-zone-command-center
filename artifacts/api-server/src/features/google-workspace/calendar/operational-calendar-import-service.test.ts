import { describe, expect, it, vi } from "vitest";

import {
  bookingOperationalWindows,
  bookingPackageSelections,
  bookings,
  packageTemplates,
  travelLegs,
} from "@/db/schema";
import type { OperationalCalendarEvent } from "./operational-calendar-client";
import { OperationalCalendarImportService } from "./operational-calendar-import-service";

const managerFixtures = [
  { token: "ANGEL", eventName: "Sweetwater County Fair", city: "Rock Springs", region: "WY", packageName: "Zone", packageCode: "adventure_zone" },
  { token: "DAVE", eventName: "Beaverhead County Fair", city: "Dillon", region: "MT", packageName: "Warrior", packageCode: "weekend_warriors" },
  { token: "HULK", eventName: "Millard County Fair", city: "Delta", region: "UT", packageName: "Pirates", packageCode: "pirates_rebellion" },
  { token: "KRISTY", eventName: "Eastern Montana Fair", city: "Miles City", region: "MT", packageName: "Zone", packageCode: "adventure_zone" },
] as const;

function eventFor(fixture: (typeof managerFixtures)[number], index: number): OperationalCalendarEvent {
  const day = String(10 + index).padStart(2, "0");
  return {
    id: `google-${fixture.token.toLowerCase()}`,
    etag: `etag-${index}`,
    updated: "2026-08-01T00:00:00.000Z",
    status: "confirmed",
    summary: `${fixture.token} ${fixture.eventName} - ${fixture.city} ${fixture.region} (${fixture.packageName})`,
    description: `EVENT DATES: September ${day}, 2026\nCONTRACT SIGNED: Pending`,
    startDate: `2026-09-0${index + 1}`,
    endDateExclusive: `2026-09-0${index + 4}`,
  };
}

describe("OperationalCalendarImportService manager reconciliation", () => {
  it("matches, completes, and idempotently refreshes ANGEL, DAVE, HULK, and KRISTY bookings", async () => {
    const events = managerFixtures.map(eventFor);
    const bookingRows = managerFixtures.map((fixture, index) => ({
      id: `booking-${fixture.token.toLowerCase()}`,
      organizationId: `org-${fixture.token.toLowerCase()}`,
      name: fixture.eventName,
      city: fixture.city,
      region: fixture.region,
      startsAt: new Date(`2026-09-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`),
      endsAt: new Date(`2026-09-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`),
      travelLegId: `leg-${fixture.token.toLowerCase()}`,
      status: "possible",
      probability: "possible",
      address1: null,
      notes: null,
    }));
    const linksByEvent = new Map<string, any>();
    const bookingUpdates: Array<Record<string, unknown>> = [];
    const packageSelections: Array<Record<string, unknown>> = [];
    const operationalWindows: Array<Record<string, unknown>> = [];

    function rowsFor(table: unknown, selection: Record<string, unknown> | undefined) {
      if (table === travelLegs) {
        return managerFixtures.map((fixture) => ({
          id: `leg-${fixture.token.toLowerCase()}`,
          name: fixture.token,
        }));
      }
      if (table === packageTemplates) {
        return [...new Map(managerFixtures.map((fixture) => [
          fixture.packageCode,
          { id: `package-${fixture.packageCode}`, code: fixture.packageCode, name: fixture.packageName },
        ])).values()];
      }
      if (table === bookings && selection && "booking" in selection) {
        return bookingRows.map((booking, index) => ({
          booking,
          legName: managerFixtures[index]!.token,
        }));
      }
      if (table === bookings && selection && "name" in selection) {
        return [{ name: "Matched booking" }];
      }
      if (table === bookings) return [bookingRows[bookingUpdates.length % bookingRows.length]];
      return [];
    }

    const db = {
      select: vi.fn((selection?: Record<string, unknown>) => {
        let table: unknown;
        const query: any = {
          from(value: unknown) { table = value; return query; },
          leftJoin() { return query; },
          where() { return query; },
          limit: async () => rowsFor(table, selection),
          orderBy: async () => rowsFor(table, selection),
          then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
            return Promise.resolve(rowsFor(table, selection)).then(resolve, reject);
          },
        };
        return query;
      }),
      update: vi.fn((table: unknown) => ({
        set(values: Record<string, unknown>) {
          if (table === bookings) bookingUpdates.push(values);
          return { where: vi.fn().mockResolvedValue(undefined) };
        },
      })),
      insert: vi.fn((table: unknown) => ({
        values(values: Record<string, unknown>) {
          if (table === bookingPackageSelections) packageSelections.push(values);
          if (table === bookingOperationalWindows) operationalWindows.push(values);
          return {
            onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
            onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
          };
        },
      })),
    };
    const links = {
      findByGoogleEvent: vi.fn(async ({ googleEventId }: { googleEventId: string }) =>
        linksByEvent.get(googleEventId) ?? null),
      createReview: vi.fn(),
      saveSuccessfulSync: vi.fn(async (input: any) => {
        const link = { id: `link-${input.googleEventId}`, ...input };
        linksByEvent.set(input.googleEventId, link);
        return link;
      }),
    };
    const client = {
      listEvents: vi.fn(async () => ({ events, nextPageToken: null })),
    };
    const service = new OperationalCalendarImportService(
      db as any,
      async () => ({ connectionId: "connection-1", calendarId: "calendar-1", client: client as any }),
      links as any,
      () => new Date("2026-08-30T00:00:00.000Z"),
    );

    const first = await service.importWindow({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-10-01T00:00:00.000Z"),
    });
    const second = await service.importWindow({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-10-01T00:00:00.000Z"),
    });

    expect(first).toMatchObject({ matched: 4, created: 0, review: 0, rows: 4 });
    expect(second).toMatchObject({ matched: 0, created: 0, updated: 4, review: 0, rows: 4 });
    expect(second.results.every((result) => result.outcome === "already_linked")).toBe(true);
    expect(linksByEvent).toHaveLength(4);
    expect(links.createReview).not.toHaveBeenCalled();
    expect(bookingUpdates).toHaveLength(8);
    expect(bookingUpdates).toEqual(expect.arrayContaining(managerFixtures.flatMap((fixture, index) => [
      expect.objectContaining({
        status: "confirmed",
        startsAt: new Date(`2026-09-${String(10 + index).padStart(2, "0")}T00:00:00.000Z`),
        travelLegId: `leg-${fixture.token.toLowerCase()}`,
        notes: expect.stringContaining("CONTRACT SIGNED: Pending"),
      }),
      expect.objectContaining({
        status: "confirmed",
        travelLegId: `leg-${fixture.token.toLowerCase()}`,
      }),
    ])));
    expect(bookingUpdates.every((update) => !("contractSigned" in update))).toBe(true);
    expect(new Set(packageSelections.map((selection) => selection.packageTemplateId))).toEqual(new Set([
      "package-adventure_zone",
      "package-weekend_warriors",
      "package-pirates_rebellion",
    ]));
    expect(operationalWindows).toHaveLength(8);
  });
});