import { describe, expect, it } from "vitest";

import { setLastResortInputSchema } from "@/features/organizations/last-resort-input";
import { organizationListQuerySchema } from "@/features/organizations/last-resort-input";

const organizationId = "11111111-1111-4111-8111-111111111111";

describe("setLastResortInputSchema", () => {
  it("requires a reason when enabling Last Resort", () => {
    const result = setLastResortInputSchema.safeParse({
      organizationId,
      enabled: true,
      reason: "   ",
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: ["reason"],
          message: "Add a Last Resort reason",
        }),
      ]),
    );
  });

  it("trims and preserves the reason", () => {
    expect(
      setLastResortInputSchema.parse({
        organizationId,
        enabled: true,
        reason: "  Repeated cancellations from the venue.  ",
      }),
    ).toEqual({
      organizationId,
      enabled: true,
      reason: "Repeated cancellations from the venue.",
    });
  });
});

describe("organizationListQuerySchema", () => {
  it("bounds organization pagination and preserves supported filters", () => {
    expect(
      organizationListQuerySchema.parse({
        q: "  Marias   Fair ",
        lastResort: "only",
        leg: "22222222-2222-4222-8222-222222222222",
        page: "-4",
        pageSize: "999",
      }),
    ).toEqual({
      search: "Marias Fair",
      lastResort: "only",
      travelLegId: "22222222-2222-4222-8222-222222222222",
      page: 1,
      pageSize: 50,
    });
  });
});
