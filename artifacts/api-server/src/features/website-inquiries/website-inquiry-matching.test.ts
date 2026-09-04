import { describe, expect, it, vi } from "vitest";

import {
  WebsiteInquiryMatchingService,
  parseCityRegion,
  rankWebsiteInquiryMatches,
  type WebsiteInquiryMatchRepository,
} from "./website-inquiry-matching";

const inquiry = {
  id: "20000000-0000-4000-8000-000000000002",
  name: "Desie Example",
  normalizedEmail: "desie@example.com",
  eventName: "Summer Festival",
  eventDate: "2027-07-04",
  eventLocation: "Denver, CO",
};

const contacts = [
  {
    id: "10000000-0000-4000-8000-000000000001",
    firstName: "Desie",
    lastName: "Example",
    email: "other@example.com",
    organizations: [],
  },
  {
    id: "10000000-0000-4000-8000-000000000002",
    firstName: "Different",
    lastName: "Person",
    email: "DESIE@example.com",
    organizations: [],
  },
];

const organizations = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    name: "Summer Festival",
    city: "Boulder",
    region: "CO",
    bookings: [],
    relatedContactIds: [],
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    name: "Another Event",
    city: "Denver",
    region: "CO",
    bookings: [{ startsAt: new Date("2027-07-14T18:00:00.000Z") }],
    relatedContactIds: [],
  },
];

describe("website inquiry matching", () => {
  it("ranks exact email above every name-only contact", () => {
    const result = rankWebsiteInquiryMatches({ inquiry, contacts, organizations: [] });
    expect(result.contacts.map(({ id }) => id)).toEqual([
      "10000000-0000-4000-8000-000000000002",
      "10000000-0000-4000-8000-000000000001",
    ]);
    expect(result.contacts[0]?.reasons).toContain("Exact email match");
  });

  it("ranks normalized full-name equality above fuzzy similarity and excludes similarity below 0.72", () => {
    const result = rankWebsiteInquiryMatches({
      inquiry,
      contacts: [
        contacts[0]!,
        {
          id: "10000000-0000-4000-8000-000000000003",
          firstName: "Desi",
          lastName: "Example",
          email: null,
          organizations: [],
        },
        {
          id: "10000000-0000-4000-8000-000000000004",
          firstName: "Completely",
          lastName: "Different",
          email: null,
          organizations: [],
        },
      ],
      organizations: [],
    });
    expect(result.contacts.map(({ id }) => id)).toEqual([
      "10000000-0000-4000-8000-000000000001",
      "10000000-0000-4000-8000-000000000003",
    ]);
    expect(result.contacts[0]?.reasons).toContain("Exact normalized name match");
  });

  it("adds a related likely-profile reason without declaring an automatic merge", () => {
    const related = {
      ...contacts[0]!,
      organizations: [
        {
          id: organizations[0]!.id,
          name: organizations[0]!.name,
          city: organizations[0]!.city,
          region: organizations[0]!.region,
        },
      ],
    };
    const result = rankWebsiteInquiryMatches({
      inquiry,
      contacts: [related],
      organizations,
    });
    expect(result.contacts[0]?.reasons).toContain(
      "Related to a likely event profile",
    );
    expect(JSON.stringify(result)).not.toMatch(/automatic merge/i);
  });

  it("ranks an exact normalized event name above location/date-only evidence", () => {
    const result = rankWebsiteInquiryMatches({ inquiry, contacts: [], organizations });
    expect(result.organizations.map(({ id }) => id)).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
    ]);
    expect(result.organizations[0]?.reasons).toContain(
      "Exact normalized event name match",
    );
    expect(result.organizations[1]?.reasons).toEqual(
      expect.arrayContaining(["Same city and state", "Event date is within 30 days"]),
    );
  });

  it("parses City, ST locations and rejects locations without a two-letter state", () => {
    expect(parseCityRegion(" Denver, co ")).toEqual({
      city: "Denver",
      region: "CO",
    });
    expect(parseCityRegion("Denver, Colorado")).toBeNull();
    expect(parseCityRegion(null)).toBeNull();
  });

  it("adds date proximity only within 30 calendar days", () => {
    const result = rankWebsiteInquiryMatches({
      inquiry,
      contacts: [],
      organizations: [
        {
          ...organizations[1]!,
          bookings: [
            { startsAt: new Date("2027-08-03T12:00:00.000Z") },
            { startsAt: new Date("2027-08-04T12:00:00.000Z") },
          ],
        },
      ],
    });
    expect(result.organizations[0]?.reasons).toContain(
      "Event date is within 30 days",
    );
    expect(
      result.organizations[0]?.context.nearestBookingDate,
    ).toBe("2027-08-03");
  });

  it("breaks score ties by normalized label and then UUID", () => {
    const result = rankWebsiteInquiryMatches({
      inquiry: { ...inquiry, name: "No Name Match", normalizedEmail: null },
      contacts: [],
      organizations: [
        { ...organizations[1]!, id: "30000000-0000-4000-8000-000000000003", name: "Zulu" },
        { ...organizations[1]!, id: "30000000-0000-4000-8000-000000000002", name: "Alpha" },
        { ...organizations[1]!, id: "30000000-0000-4000-8000-000000000001", name: "alpha" },
      ],
    });
    expect(result.organizations.map(({ id }) => id)).toEqual([
      "30000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000002",
      "30000000-0000-4000-8000-000000000003",
    ]);
  });

  it("returns at most 20 read-only manual search results", async () => {
    const rows = Array.from({ length: 25 }, (_, index) => ({
      id: `30000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
      label: `Festival ${index}`,
      score: 0,
      reasons: [],
      context: { city: "Denver", region: "CO" },
    }));
    const repository: WebsiteInquiryMatchRepository = {
      loadInquiry: vi.fn(async () => inquiry),
      loadContactCandidates: vi.fn(async () => []),
      loadOrganizationCandidates: vi.fn(async () => []),
      search: vi.fn(async () => rows),
    };
    const service = new WebsiteInquiryMatchingService(repository);
    const result = await service.search({ entity: "organization", query: "festival" });
    expect(result).toHaveLength(20);
    expect(Object.keys(repository)).toEqual([
      "loadInquiry",
      "loadContactCandidates",
      "loadOrganizationCandidates",
      "search",
    ]);
  });
});
