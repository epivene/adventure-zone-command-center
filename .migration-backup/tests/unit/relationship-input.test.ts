import { describe, expect, it } from "vitest";

import { associatePersonWithPlaceSchema } from "@/features/relationships/relationship-input";

describe("relationship input", () => {
  it("trims a relationship role", () => {
    expect(associatePersonWithPlaceSchema.parse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      contactId: "22222222-2222-4222-8222-222222222222",
      role: "  Event Director  ",
    }).role).toBe("Event Director");
  });

  it("turns a blank role into null", () => {
    expect(associatePersonWithPlaceSchema.parse({
      organizationId: "11111111-1111-4111-8111-111111111111",
      contactId: "22222222-2222-4222-8222-222222222222",
      role: " ",
    }).role).toBeNull();
  });

  it("rejects non-UUID relationship identifiers", () => {
    expect(associatePersonWithPlaceSchema.safeParse({
      organizationId: "not-an-id",
      contactId: "also-not-an-id",
      role: null,
    }).success).toBe(false);
  });
});
