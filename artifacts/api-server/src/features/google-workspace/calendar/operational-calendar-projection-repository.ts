import { and, eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import {
  bookingOperationalWindows,
  bookingPackageSelections,
  bookings,
  contacts,
  packageTemplates,
  travelLegs,
} from "@/db/schema";
import type { ConfirmedBookingProjection } from "./operational-calendar-renderer";
import type { OperationalCalendarPackageKey } from "@workspace/db/operational-calendar-schema";

type DrizzleDatabase = typeof database;

function dateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function actualEventDateText(startsAt: Date, endsAt: Date) {
  const startKey = dateKey(startsAt);
  const endKey = dateKey(endsAt);
  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  if (startKey === endKey) return formatter.format(startsAt);
  return `${formatter.format(startsAt)} – ${formatter.format(endsAt)}`;
}

function packageKey(code: string): OperationalCalendarPackageKey | null {
  const normalized = code.trim().toLowerCase();
  if (normalized === "adventure_zone" || normalized === "mini_zone") return "zone";
  if (normalized === "pirates_rebellion" || normalized === "pirate_rebellion") return "pirates";
  if (normalized === "weekend_warriors" || normalized === "warriors_playground") return "warrior";
  return null;
}

function contactText(contact: typeof contacts.$inferSelect | null) {
  if (!contact) return null;
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ").trim();
  return [name, contact.phone, contact.email].filter(Boolean).join(" · ") || null;
}

function addressText(booking: typeof bookings.$inferSelect) {
  return [
    booking.venueName,
    booking.address1,
    [booking.city, booking.region, booking.postalCode].filter(Boolean).join(" "),
  ].filter(Boolean).join(", ") || null;
}

export type OperationalCalendarProjection = ConfirmedBookingProjection & {
  bookingId: string;
};

export class OperationalCalendarProjectionRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async loadConfirmedBooking(bookingId: string): Promise<OperationalCalendarProjection | null> {
    const [row] = await this.db
      .select({
        booking: bookings,
        leg: travelLegs,
        contact: contacts,
        operationalStartsAt: bookingOperationalWindows.startsAt,
        operationalEndsAt: bookingOperationalWindows.endsAt,
        operationalSource: bookingOperationalWindows.source,
      })
      .from(bookings)
      .leftJoin(travelLegs, eq(bookings.travelLegId, travelLegs.id))
      .leftJoin(contacts, eq(bookings.primaryContactId, contacts.id))
      .leftJoin(bookingOperationalWindows, eq(bookings.id, bookingOperationalWindows.bookingId))
      .where(eq(bookings.id, bookingId))
      .limit(1);

    if (
      !row ||
      row.booking.status !== "confirmed" ||
      !row.booking.startsAt ||
      !row.booking.endsAt ||
      !row.leg
    ) {
      return null;
    }

    const packageRows = await this.db
      .select({ code: packageTemplates.code, name: packageTemplates.name })
      .from(bookingPackageSelections)
      .innerJoin(packageTemplates, eq(bookingPackageSelections.packageTemplateId, packageTemplates.id))
      .where(eq(bookingPackageSelections.bookingId, bookingId));
    const packages = [...new Set(packageRows.map((item) => packageKey(item.code)).filter(
      (value): value is OperationalCalendarPackageKey => value !== null,
    ))];
    if (!packages.length) return null;

    const hasDistinctOperationalWindow = Boolean(
      row.operationalStartsAt &&
      row.operationalEndsAt &&
      (
        dateKey(row.operationalStartsAt) !== dateKey(row.booking.startsAt) ||
        dateKey(row.operationalEndsAt) !== dateKey(row.booking.endsAt) ||
        row.operationalSource === "google_calendar" ||
        row.operationalSource === "manual"
      ),
    );
    const reservedStart = hasDistinctOperationalWindow
      ? row.operationalStartsAt!
      : addUtcDays(row.booking.startsAt, -2);
    // Operational window is stored as a half-open range. Default adds one teardown day,
    // then advances to the exclusive calendar end date.
    const reservedEnd = hasDistinctOperationalWindow
      ? row.operationalEndsAt!
      : addUtcDays(row.booking.endsAt, 2);

    return {
      bookingId,
      managerName: row.leg.name,
      eventName: row.booking.name,
      city: row.booking.city,
      region: row.booking.region,
      actualEventDateText: actualEventDateText(row.booking.startsAt, row.booking.endsAt),
      reservedStart,
      reservedEnd,
      packages,
      contactText: contactText(row.contact),
      addressText: addressText(row.booking),
      attractionText: packageRows.map((item) => item.name).join(" + ") || null,
      additionalInfo: row.booking.notes?.trim() || null,
      paymentInfo: null,
      invoiceSent: null,
      contractSigned: null,
      depositReceived: null,
      amountDue: null,
    };
  }

  async saveOperationalWindow(input: {
    bookingId: string;
    startsAt: Date;
    endsAt: Date;
    source: "app" | "google_calendar" | "manual";
  }): Promise<void> {
    await this.db
      .insert(bookingOperationalWindows)
      .values({
        bookingId: input.bookingId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        source: input.source,
      })
      .onConflictDoUpdate({
        target: bookingOperationalWindows.bookingId,
        set: {
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          source: input.source,
          updatedAt: new Date(),
        },
      });
  }
}
