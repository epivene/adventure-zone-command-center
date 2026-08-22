import { describe, expect, it } from "vitest";
import { projectOfficeProfile } from "./office-profile-service";

const profile = {
  id: "10000000-0000-4000-8000-000000000001",
  place: {
    id: "10000000-0000-4000-8000-000000000001",
    name: "County Fair",
    phone: "7015550100",
    address1: "1 Fair Way",
    address2: null,
    city: "Example",
    region: "ND",
    postalCode: "58000",
    website: "https://example.org",
    lastResort: true,
    lastResortReason: "private strategy",
    actRecordId: "ACT-1",
  },
  contacts: [{
    id: "20000000-0000-4000-8000-000000000001",
    name: "Alex Smith",
    role: "Director",
    isPrimary: true,
    phone: "7015550101",
    email: "alex@example.org",
    locationName: null,
    actRecordId: "ACT-C1",
  }],
  bookings: [{
    id: "30000000-0000-4000-8000-000000000001",
    name: "2027 County Fair",
    primaryContactId: null,
    city: "Example",
    region: "ND",
    startsAt: new Date("2027-07-01T12:00:00Z"),
    endsAt: new Date("2027-07-03T12:00:00Z"),
    status: "possible",
    probability: "likely",
    notes: "private sales strategy",
    actRecordId: "ACT-B1",
    travelLeg: { id: "secret-leg" },
  }],
  notes: [{ id: "n1", kind: "note", body: "Call main office", occurredAt: new Date("2026-08-01T12:00:00Z"), actSourceType: "history" }],
  sourceProvenance: [{ actRecordId: "ACT-1" }],
  groups: [{ id: "g1", name: "secret group" }],
  managerReviews: [{ rating: 5 }],
};

describe("Office profile projection", () => {
  it("keeps factual working context and profile identity while omitting owner-only strategy and provenance", () => {
    const view = projectOfficeProfile(profile as any, {
      description: "Annual county fair",
      profileImageDataUrl: "data:image/jpeg;base64,abc123",
      locations: [],
      mailActivity: [],
    });

    expect(view.name).toBe("County Fair");
    expect(view.description).toBe("Annual county fair");
    expect(view.profileImageDataUrl).toBe("data:image/jpeg;base64,abc123");
    expect(view.contacts[0]).toMatchObject({ name: "Alex Smith", role: "Director" });
    expect(view.bookings[0]).toMatchObject({ name: "2027 County Fair", status: "possible" });
    expect(JSON.stringify(view)).not.toMatch(/probability|lastResort|lastResortReason|travelLeg|sourceProvenance|actRecordId|managerReviews|private sales strategy|secret group/);
  });
});
