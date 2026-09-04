import { describe, expect, it } from "vitest";

import { evaluateDraftReadiness } from "./draft-readiness-policy";
import { renderLeadEmail } from "./lead-email-renderer";

const availability = {
  status: "resolved" as const,
  packages: [
    { packageKey: "adventure_zone", availableQuantity: 1 },
    { packageKey: "pirates_rebellion", availableQuantity: 0 },
    { packageKey: "weekend_warriors", availableQuantity: 1 },
    { packageKey: "mini_zone", availableQuantity: 9 },
  ],
  restrictedOptions: [{ packageKey: "mini_zone", approvalRequired: true as const }],
  blockers: [],
};

describe("evaluateDraftReadiness", () => {
  const input = {
    rowState: "verified",
    recipientEmail: "  CONTACT@EXAMPLE.COM ",
    recipientConfirmed: true,
    introductionSuitable: true,
    relationshipOutcome: "new_introduction" as const,
    territoryStatus: "open" as const,
    fitStatus: "approved" as const,
    availability: { ready: true, checkedAt: "2026-08-26T12:00:00.000Z", packageAvailability: availability },
    now: new Date("2026-08-26T12:59:59.000Z"),
  };

  it("is ready only for the approved relationship, fresh resolved availability, and positive normal inventory", () => {
    expect(evaluateDraftReadiness(input)).toEqual({ ready: true, blockers: [] });
  });

  it("fails closed for active exact recipient, row, profile, and contact DO NOT SEND blocks", () => {
    for (const target of [
      { targetType: "recipient_email" as const, normalizedEmail: "contact@example.com" },
      { targetType: "lead_import_row" as const, rowId: "row-1" },
      { targetType: "organization" as const, organizationId: "org-1" },
      { targetType: "contact" as const, contactId: "contact-1" },
    ]) {
      expect(evaluateDraftReadiness({
        ...input,
        rowId: "row-1",
        organizationId: "org-1",
        contactId: "contact-1",
        communicationBlocks: [{ ...target, active: true }],
      })).toMatchObject({ ready: false, blockers: ["do_not_send"] });
    }
  });

  it("does not block for inactive blocks or an unrelated email", () => {
    expect(evaluateDraftReadiness({
      ...input,
      communicationBlocks: [
        { targetType: "recipient_email", normalizedEmail: "other@example.com", active: true },
        { targetType: "lead_import_row", rowId: "row-1", active: false },
      ],
    })).toEqual({ ready: true, blockers: [] });
  });

  it("blocks stale, unresolved, empty-normal, review, territory, fit, and unapproved relationship states", () => {
    const cases = [
      { availability: { ...input.availability, checkedAt: "2026-08-26T10:59:59.000Z" }, blocker: "availability_stale" },
      { availability: { ...input.availability, packageAvailability: { ...availability, status: "unresolved" as const } }, blocker: "availability_unresolved" },
      { availability: { ...input.availability, packageAvailability: { ...availability, packages: availability.packages.map((item) => ({ ...item, availableQuantity: 0 })) } }, blocker: "no_normal_package_available" },
      { relationshipOutcome: "returning_contact" as const, blocker: "template_not_approved" },
      { relationshipOutcome: "needs_review" as const, blocker: "relationship_needs_review" },
      { territoryStatus: "needs_review" as const, blocker: "territory_not_open" },
      { fitStatus: "needs_review" as const, blocker: "fit_not_approved" },
    ];
    for (const testCase of cases) {
      expect(evaluateDraftReadiness({ ...input, ...testCase })).toMatchObject({ ready: false, blockers: [testCase.blocker] });
    }
  });
});

describe("renderLeadEmail", () => {
  it("renders exact approved copy, a verified uppercase date range, and only positive normal packages", () => {
    const preview = renderLeadEmail({
      profileName: "Aspen Filmfest",
      eventName: "Aspen Filmfest",
      eventCity: "Aspen",
      eventRegion: "CO",
      startDate: "2026-09-29",
      endDate: "2026-10-04",
      firstName: "Jamie",
      packageAvailability: availability,
    });

    expect(preview.subject).toBe("Aspen Filmfest (Aspen) CO SEPT 29 – OCT 4, 2026");
    expect(preview.body).toContain("Hi, Jamie");
    expect(preview.body).toContain("We represent The Adventure Zone -- America's Best Inflatable Carnival!");
    expect(preview.body).toContain("Our Adventure Zone units feature 10 amazing inflatable attractions");
    expect(preview.body).toContain("For the teenage crowd and thrill seekers");
    expect(preview.body).toContain("available for $8,000 (for 1-4 days)");
    expect(preview.body).not.toContain("available for $7,500");
    expect(preview.body).not.toContain("Release your inner Pirate");
    expect(preview.body).not.toContain("Mini Zone");
    expect(preview.body).not.toMatch(/no[ -]?upfront|ticket sales|guarantee|discount/i);
    expect(preview.body).toContain("Don’t forget, with every unit, we provide:");
    expect(preview.body).toContain("EMAIL: TheAdventureZone12@gmail.com");
  });

  it("quotes Pirate's Rebellion at the current $8,000 price", () => {
    const preview = renderLeadEmail({
      profileName: "Example Fair",
      eventName: "Example Fair",
      eventCity: "Example City",
      eventRegion: "CO",
      startDate: "2026-09-29",
      endDate: "2026-09-29",
      firstName: "Jamie",
      packageAvailability: {
        ...availability,
        packages: availability.packages.map((item) => ({
          ...item,
          availableQuantity: item.packageKey === "pirates_rebellion" ? 1 : 0,
        })),
      },
    });

    expect(preview.body).toContain("Release your inner Pirate");
    expect(preview.body).toContain("available for $8,000 (for 1-4 days)");
    expect(preview.body).not.toContain("available for $7,500");
  });

  it("uses a safe organization greeting and event-based closing when person or city is absent", () => {
    const preview = renderLeadEmail({
      profileName: "Example Fair",
      eventName: "Example Fair",
      eventCity: null,
      eventRegion: null,
      startDate: "2026-09-29",
      endDate: "2026-09-29",
      firstName: null,
      packageAvailability: availability,
    });
    expect(preview.body).toContain("Hi,\n");
    expect(preview.body).toContain("We hope to join in your Example Fair celebration.");
    expect(preview.body).not.toContain("your  celebration");
  });
});
