import { describe, expect, it } from "vitest";

import {
  addSpecialRequestInputSchema,
  configureBookingPackagesInputSchema,
  decideSpecialRequestInputSchema,
} from "@/features/packages/package-input";

const ids = {
  booking: "11111111-1111-4111-8111-111111111111",
  packageOne: "22222222-2222-4222-8222-222222222222",
  packageTwo: "33333333-3333-4333-8333-333333333333",
  assignment: "44444444-4444-4444-8444-444444444444",
  request: "55555555-5555-4555-8555-555555555555",
  mixedCase: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

describe("package input schemas", () => {
  it("parses a two-package configuration and trims nullable text", () => {
    expect(configureBookingPackagesInputSchema.parse({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageOne, ids.packageTwo],
      physicalAttractionTotal: 11,
      attractionTotalApprovalReason: "  approved exception  ",
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: null,
      }],
    })).toEqual({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageOne, ids.packageTwo],
      physicalAttractionTotal: 11,
      attractionTotalApprovalReason: "approved exception",
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: null,
      }],
    });
  });

  it.each([
    ["duplicate selected packages", {
      packageTemplateIds: [ids.packageOne, ids.packageOne],
    }],
    ["duplicate assignment rows", {
      manualAttributions: [
        {
          bookingResourceAssignmentId: ids.assignment,
          packageTemplateIds: null,
        },
        {
          bookingResourceAssignmentId: ids.assignment,
          packageTemplateIds: [],
        },
      ],
    }],
    ["duplicate manual package IDs", {
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: [ids.packageOne, ids.packageOne],
      }],
    }],
    ["a fractional attraction total", {
      physicalAttractionTotal: 10.5,
    }],
    ["a negative attraction total", {
      physicalAttractionTotal: -1,
    }],
  ])("rejects %s", (_name, override) => {
    const result = configureBookingPackagesInputSchema.safeParse({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageOne],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [],
      ...override,
    });

    expect(result.success).toBe(false);
  });

  it("preserves an empty manual package list as a deliberate empty override", () => {
    const result = configureBookingPackagesInputSchema.parse({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageOne],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: [],
      }],
    });

    expect(result.manualAttributions[0]?.packageTemplateIds).toEqual([]);
  });

  it("normalizes every UUID field to canonical lowercase", () => {
    const upper = ids.mixedCase.toUpperCase();
    expect(configureBookingPackagesInputSchema.parse({
      bookingId: upper,
      packageTemplateIds: [upper],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [{
        bookingResourceAssignmentId: upper,
        packageTemplateIds: [upper],
      }],
    })).toMatchObject({
      bookingId: ids.mixedCase,
      packageTemplateIds: [ids.mixedCase],
      manualAttributions: [{
        bookingResourceAssignmentId: ids.mixedCase,
        packageTemplateIds: [ids.mixedCase],
      }],
    });
    expect(decideSpecialRequestInputSchema.parse({
      specialRequestId: upper,
      decision: "approved",
      reason: "Approved",
    }).specialRequestId).toBe(ids.mixedCase);
  });

  it.each([
    ["selected packages", {
      packageTemplateIds: [ids.mixedCase, ids.mixedCase.toUpperCase()],
    }],
    ["assignment rows", {
      manualAttributions: [
        {
          bookingResourceAssignmentId: ids.mixedCase,
          packageTemplateIds: null,
        },
        {
          bookingResourceAssignmentId: ids.mixedCase.toUpperCase(),
          packageTemplateIds: null,
        },
      ],
    }],
    ["manual package IDs", {
      manualAttributions: [{
        bookingResourceAssignmentId: ids.assignment,
        packageTemplateIds: [
          ids.mixedCase,
          ids.mixedCase.toUpperCase(),
        ],
      }],
    }],
  ])("rejects mixed-case semantic duplicates in %s", (_name, override) => {
    expect(configureBookingPackagesInputSchema.safeParse({
      bookingId: ids.booking,
      packageTemplateIds: [ids.packageOne],
      physicalAttractionTotal: 10,
      attractionTotalApprovalReason: null,
      manualAttributions: [],
      ...override,
    }).success).toBe(false);
  });

  it.each(["add_to_count", "replace_included", "note_only"] as const)(
    "accepts the %s request treatment and starts without decision fields",
    (treatment) => {
      expect(addSpecialRequestInputSchema.parse({
        bookingId: ids.booking,
        description: "  Ferris wheel  ",
        treatment,
      })).toEqual({
        bookingId: ids.booking,
        description: "Ferris wheel",
        treatment,
      });
    },
  );

  it("allows only approve or decline decisions with a nonblank reason", () => {
    expect(decideSpecialRequestInputSchema.parse({
      specialRequestId: ids.request,
      decision: "approved",
      reason: "  Approved by owner  ",
    })).toEqual({
      specialRequestId: ids.request,
      decision: "approved",
      reason: "Approved by owner",
    });
    expect(decideSpecialRequestInputSchema.safeParse({
      specialRequestId: ids.request,
      decision: "needs_approval",
      reason: "Waiting",
    }).success).toBe(false);
    expect(decideSpecialRequestInputSchema.safeParse({
      specialRequestId: ids.request,
      decision: "declined",
      reason: " ",
    }).success).toBe(false);
  });

  it("uses strict UUID and object validation at the server boundary", () => {
    expect(addSpecialRequestInputSchema.safeParse({
      bookingId: "not-a-uuid",
      description: "Ferris wheel",
      treatment: "add_to_count",
    }).success).toBe(false);
    expect(addSpecialRequestInputSchema.safeParse({
      bookingId: ids.booking,
      description: "Ferris wheel",
      treatment: "add_to_count",
      approvalStatus: "approved",
    }).success).toBe(false);
  });
});
