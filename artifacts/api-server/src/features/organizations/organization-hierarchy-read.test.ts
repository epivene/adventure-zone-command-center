import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { bookingStatusValues } from "@/features/bookings/booking-types";
import { isActiveStatus } from "@/features/follow-ups/follow-up-policy";

import {
  assembleOrganizationHierarchy,
  organizationHierarchyLocationQuery,
  organizationHierarchyRollupQuery,
  organizationHierarchyTravelLegQuery,
  organizationOwnedRecordCondition,
  type OrganizationHierarchyRollups,
  type OrganizationLocationAggregateRecord,
  type OrganizationLocationSummary,
  type OrganizationParentSummary,
} from "./organization-repository";

const parentId = "10000000-0000-4000-8000-000000000001";
const austinId = "20000000-0000-4000-8000-000000000001";
const denverId = "20000000-0000-4000-8000-000000000002";

describe("organization hierarchy reads", () => {
  it("maps bounded child aggregates to the correct location cards and parent rollups", () => {
    const parent: OrganizationParentSummary = {
      id: parentId,
      name: "Adventure Zone",
      website: "https://example.com",
    };
    const records: OrganizationLocationAggregateRecord[] = [
      {
        id: denverId,
        name: "Adventure Zone - Denver",
        address1: "200 Market St",
        address2: null,
        city: "Denver",
        region: "CO",
        postalCode: "80202",
        website: "https://example.com/denver",
        localStatus: "contacted",
        nextFollowUpId: "follow-up-denver",
        nextFollowUpKind: "call",
        nextFollowUpDueAt: new Date("2026-08-15T16:00:00.000Z"),
        nextBookingId: "booking-denver",
        nextBookingName: "Denver Festival",
        nextBookingStartsAt: new Date("2026-09-20T14:00:00.000Z"),
        nextBookingStatus: "contacted",
        travelLegId: "leg-west",
        travelLegName: "West",
        travelLegColor: "#3366ff",
        primaryContactFirstName: "Dana",
        primaryContactLastName: "Diaz",
      },
      {
        id: austinId,
        name: "Adventure Zone - Austin",
        address1: "100 Congress Ave",
        address2: "Suite 10",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        website: "https://example.com/austin",
        localStatus: "confirmed",
        nextFollowUpId: "follow-up-austin",
        nextFollowUpKind: "email",
        nextFollowUpDueAt: new Date("2026-08-14T15:00:00.000Z"),
        nextBookingId: "booking-austin",
        nextBookingName: "Austin Festival",
        nextBookingStartsAt: new Date("2026-09-10T14:00:00.000Z"),
        nextBookingStatus: "confirmed",
        travelLegId: "leg-south",
        travelLegName: "South",
        travelLegColor: "#ff6600",
        primaryContactFirstName: "Alex",
        primaryContactLastName: "Austin",
      },
    ];
    const rollupRecord = {
      locationCount: 2,
      upcomingBookingCount: 3,
      overdueFollowUpCount: 1,
      mostRecentContactAt: new Date("2026-08-12T18:30:00.000Z"),
    };
    const representedTravelLegs = [
      { id: "leg-south", name: "South", color: "#ff6600" },
      { id: "leg-west", name: "West", color: "#3366ff" },
    ];

    const result = assembleOrganizationHierarchy(
      parent,
      records,
      rollupRecord,
      representedTravelLegs,
    );

    expect(result.parent).toEqual(parent);
    expect(result.locations.map(({ id }) => id)).toEqual([austinId, denverId]);
    expect(result.locations).toEqual([
      {
        id: austinId,
        name: "Adventure Zone - Austin",
        address1: "100 Congress Ave",
        address2: "Suite 10",
        city: "Austin",
        region: "TX",
        postalCode: "78701",
        website: "https://example.com/austin",
        localStatus: "confirmed",
        nextFollowUp: {
          id: "follow-up-austin",
          kind: "email",
          dueAt: new Date("2026-08-14T15:00:00.000Z"),
        },
        nextBooking: {
          id: "booking-austin",
          name: "Austin Festival",
          startsAt: new Date("2026-09-10T14:00:00.000Z"),
          status: "confirmed",
        },
        travelLeg: { id: "leg-south", name: "South", color: "#ff6600" },
        primaryContactName: "Alex Austin",
      },
      {
        id: denverId,
        name: "Adventure Zone - Denver",
        address1: "200 Market St",
        address2: null,
        city: "Denver",
        region: "CO",
        postalCode: "80202",
        website: "https://example.com/denver",
        localStatus: "contacted",
        nextFollowUp: {
          id: "follow-up-denver",
          kind: "call",
          dueAt: new Date("2026-08-15T16:00:00.000Z"),
        },
        nextBooking: {
          id: "booking-denver",
          name: "Denver Festival",
          startsAt: new Date("2026-09-20T14:00:00.000Z"),
          status: "contacted",
        },
        travelLeg: { id: "leg-west", name: "West", color: "#3366ff" },
        primaryContactName: "Dana Diaz",
      },
    ] satisfies OrganizationLocationSummary[]);
    expect(result.rollups).toEqual({
      ...rollupRecord,
      travelLegs: representedTravelLegs,
    } satisfies OrganizationHierarchyRollups);
  });
});


function render(statement: SQL) {
  const query = new PgDialect().sqlToQuery(statement);
  return {
    sql: query.sql
      .toLowerCase()
      .replace(/\s+/g, " ")
      .replace(/\(\s+/g, "(")
      .replace(/\s+\)/g, ")")
      .trim(),
    params: query.params,
  };
}

describe("organization hierarchy aggregate SQL", () => {
  it("gives explicit organization and booking ownership priority over a shared contact", () => {
    const rendered = render(
      organizationOwnedRecordCondition(
        {
          organizationId: sql.raw("record.organization_id"),
          bookingId: sql.raw("record.booking_id"),
          contactId: sql.raw("record.contact_id"),
        },
        sql.raw("record.organization_id = owner.id"),
        sql.raw("booking.organization_id = owner.id"),
        sql.raw("contact_association.organization_id = owner.id"),
      ),
    ).sql;

    expect(rendered).toContain(
      "(record.organization_id is not null and record.organization_id = owner.id)",
    );
    expect(rendered).toContain(
      "(record.organization_id is null and record.booking_id is not null and booking.organization_id = owner.id)",
    );
    expect(rendered).toContain(
      "(record.organization_id is null and record.booking_id is null and record.contact_id is not null and contact_association.organization_id = owner.id)",
    );
  });

  it("renders bounded parent aggregates with canonical ownership and active bookings only", () => {
    const location = render(organizationHierarchyLocationQuery(parentId));
    const rollup = render(organizationHierarchyRollupQuery(parentId));
    const travelLegs = render(organizationHierarchyTravelLegQuery(parentId));
    const activeStatuses = bookingStatusValues.filter(isActiveStatus);
    const terminalStatuses = bookingStatusValues.filter(
      (status) => !isActiveStatus(status),
    );

    expect(location.sql).toContain("where child.parent_organization_id = $");
    expect(location.params).toContain(parentId);
    expect(location.sql.match(/left join lateral/g)).toHaveLength(3);
    expect(location.sql.match(/limit 1/g)).toHaveLength(3);
    expect(location.sql).toContain("candidate.organization_id is not null");
    expect(location.sql).toContain(
      "candidate.organization_id is null and candidate.booking_id is not null",
    );
    expect(location.sql).toContain(
      "candidate.organization_id is null and candidate.booking_id is null",
    );

    expect(rollup.sql).toContain('"locationcount"');
    expect(rollup.sql).toContain('"upcomingbookingcount"');
    expect(rollup.sql).toContain('"overduefollowupcount"');
    expect(rollup.sql).toContain('"mostrecentcontactat"');
    expect(rollup.sql).toContain("booking_location.parent_organization_id = $");
    expect(rollup.sql).toContain("candidate.organization_id is not null");
    expect(rollup.sql).toContain(
      "candidate.organization_id is null and candidate.booking_id is not null",
    );
    expect(rollup.sql).toContain(
      "candidate.organization_id is null and candidate.booking_id is null",
    );

    for (const status of activeStatuses) {
      expect(location.params).toContain(status);
      expect(rollup.params).toContain(status);
    }
    for (const status of terminalStatuses) {
      expect(location.params).not.toContain(status);
      expect(rollup.params).not.toContain(status);
    }

    expect(travelLegs.sql).toContain("child.parent_organization_id = $");
    expect(travelLegs.params).toContain(parentId);
  });
});
