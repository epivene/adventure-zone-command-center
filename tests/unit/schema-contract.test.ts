import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  activities,
  actContactSyncStates,
  actExternalLinks,
  actImportRuns,
  actSyncOperations,
  actSyncRuns,
  activityRevisions,
  auditEntries,
  bookings,
  callSessions,
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
      "jobTitle", "address1", "address2", "city", "region", "postalCode",
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
    expect(Object.keys(actContactSyncStates)).toEqual(expect.arrayContaining([
      "contactId", "baseSnapshot", "actEditedAt", "lastSyncedAt",
      "localDirty", "state", "createdAt", "updatedAt",
    ]));
    expect(Object.keys(actSyncRuns)).toEqual(expect.arrayContaining([
      "id", "status", "startedAt", "completedAt", "summary",
      "activeQueueToken", "createdAt",
    ]));
    expect(Object.keys(actSyncOperations)).toEqual(expect.arrayContaining([
      "id", "runId", "rowKey", "localContactId", "actRecordId", "category",
      "decision", "status", "baseSnapshot", "localSnapshot", "actSnapshot",
      "error", "retryable", "createdAt", "updatedAt",
    ]));
  });

  it("exports the CRM activity and call workspace fields", () => {
    expect(organizations.lastResort).toBeDefined();
    expect(organizations.lastResortReason).toBeDefined();
    expect(contacts.normalizedPhone).toBeDefined();
    expect(activities.organizationId).toBeDefined();
    expect(activities.contactId).toBeDefined();
    expect(activities.bookingId).toBeDefined();
    expect(activityRevisions.activityId).toBeDefined();
    expect(callSessions.disposition).toBeDefined();
  });

  it("enforces one contact owner for each Act external identifier", () => {
    expect(
      getTableConfig(actExternalLinks).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("act_external_links_entity_external_id_unique");
  });

  it("constrains contact sync state and operation identity", () => {
    expect(
      getTableConfig(actContactSyncStates).checks.map(
        (constraint) => constraint.name,
      ),
    ).toContain("act_contact_sync_states_state_valid");
    expect(
      getTableConfig(actSyncOperations).indexes
        .filter((index) => index.config.unique)
        .map((index) => index.config.name),
    ).toContain("act_sync_operations_run_row_unique");
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

  it("enforces the fixed four sort-order slots in PostgreSQL", () => {
    expect(
      getTableConfig(travelLegs).checks.map((constraint) => constraint.name),
    ).toContain("travel_legs_sort_order_between_1_and_4");
  });
});
