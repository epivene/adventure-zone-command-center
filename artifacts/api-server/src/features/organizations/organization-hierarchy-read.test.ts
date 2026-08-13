import { describe, expect, it } from "vitest";

import {
  assembleOrganizationHierarchy,
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
