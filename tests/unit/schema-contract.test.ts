import { describe, expect, it } from "vitest";
import {
  actExternalLinks,
  actImportRuns,
  auditEntries,
  bookings,
  contacts,
  followUps,
  organizations,
  travelLegs,
} from "@/db/schema";
import { initialTravelLegs } from "@/db/seed";
import { bookingStatusValues } from "@/features/bookings/booking-types";

describe("booking status contract", () => {
  it("contains the approved workflow in order", () => {
    expect(bookingStatusValues).toEqual([
      "new_lead", "researching", "contact_due", "contacted", "interested",
      "possible", "unlikely", "quote_sent", "pending_decision",
      "pending_contract", "contract_received", "confirmed", "declined",
      "cancelled", "completed", "renewal_due",
    ]);
  });
});

describe("database schema contract", () => {
  it("exports the Stage 1 normalized tables", () => {
    expect(Object.keys(contacts)).toEqual(expect.arrayContaining([
      "id", "organizationId", "firstName", "lastName", "email", "phone",
      "actRecordId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(organizations)).toEqual(expect.arrayContaining([
      "id", "name", "actRecordId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(bookings)).toEqual(expect.arrayContaining([
      "id", "organizationId", "primaryContactId", "name", "city", "region",
      "status", "probability", "travelLegId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(followUps)).toEqual(expect.arrayContaining([
      "id", "bookingId", "kind", "dueAt", "completedAt", "outcome",
      "nextFollowUpId", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(travelLegs)).toEqual(expect.arrayContaining([
      "id", "name", "color", "sortOrder", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(auditEntries)).toEqual(expect.arrayContaining([
      "id", "entityType", "entityId", "action", "before", "after", "createdAt",
    ]));
    expect(Object.keys(actImportRuns)).toEqual(expect.arrayContaining([
      "id", "sourceFileName", "status", "startedAt", "completedAt", "summary", "createdAt",
    ]));
    expect(Object.keys(actExternalLinks)).toEqual(expect.arrayContaining([
      "id", "entityType", "entityId", "actRecordId", "importRunId", "createdAt", "updatedAt",
    ]));
  });
});

describe("travel-leg seed contract", () => {
  it("provides exactly four configured travel legs in display order", () => {
    expect(initialTravelLegs).toEqual([
      { name: "Leg 1", color: "#DC3B3B", sortOrder: 1 },
      { name: "Leg 2", color: "#2F73D9", sortOrder: 2 },
      { name: "Leg 3", color: "#7B4DDB", sortOrder: 3 },
      { name: "Leg 4", color: "#15956B", sortOrder: 4 },
    ]);
  });
});
