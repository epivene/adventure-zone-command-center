import { expect, it } from "vitest";
import { evaluateDraftReadiness } from "./draft-readiness-policy";

it("does not treat unknown, rental, restricted, or Mini inventory as normal availability", () => {
  for (const packageKey of ["rental_bounce_house", "unknown", "mini_zone", "pirates_rebellion_restricted_fourth_unit"]) {
    expect(evaluateDraftReadiness({
      rowState: "verified", recipientEmail: "x@example.com", recipientConfirmed: true, introductionSuitable: true,
      relationshipOutcome: "new_introduction", territoryStatus: "open", fitStatus: "approved",
      availability: { ready: true, checkedAt: "2026-08-26T12:00:00.000Z", packageAvailability: { status: "resolved", packages: [{ packageKey, availableQuantity: 1 }], restrictedOptions: [] } },
      now: new Date("2026-08-26T12:01:00.000Z"),
    })).toMatchObject({ ready: false, blockers: ["no_normal_package_available"] });
  }
});
