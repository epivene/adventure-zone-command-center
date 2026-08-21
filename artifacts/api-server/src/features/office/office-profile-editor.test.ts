import { describe, expect, it } from "vitest";
import { officeContactInputSchema, officeLocationInputSchema, officeProfileInputSchema } from "./office-profile-input";

describe("Office factual edit allowlists", () => {
  it.each(["lastResort", "probability", "travelLegId", "sourceProvenance", "actRecordId"])("rejects owner-only profile field %s", (field) => {
    expect(officeProfileInputSchema.safeParse({ name: "Fair", [field]: "forbidden" }).success).toBe(false);
  });

  it.each(["organizationId", "doNotCallAt", "source", "actRecordId"])("rejects contact authority field %s", (field) => {
    expect(officeContactInputSchema.safeParse({
      firstName: "Alex",
      lastName: "Smith",
      jobTitle: null,
      relationshipRole: null,
      email: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      phones: [],
      [field]: "forbidden",
    }).success).toBe(false);
  });

  it.each(["doNotCallAt", "doNotCallReason", "source", "normalizedNumber"])("rejects nested phone authority field %s", (field) => {
    expect(officeContactInputSchema.safeParse({
      firstName: "Alex",
      lastName: "Smith",
      jobTitle: null,
      relationshipRole: null,
      email: null,
      address1: null,
      address2: null,
      city: null,
      region: null,
      postalCode: null,
      phones: [{
        id: null,
        number: "701-555-0100",
        type: "office",
        extension: "12",
        label: null,
        primary: true,
        [field]: "forbidden",
      }],
    }).success).toBe(false);
  });

  it.each(["travelLegId", "localStatus", "lat", "lng"])("rejects non-factual location field %s", (field) => {
    expect(officeLocationInputSchema.safeParse({ label: "Fairgrounds", [field]: "forbidden" }).success).toBe(false);
  });
});
