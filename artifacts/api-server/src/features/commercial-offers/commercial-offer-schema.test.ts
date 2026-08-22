import { describe, expect, it } from "vitest";
import {
  commercialOfferRules,
  commercialOfferKindValues,
  commercialOfferStateValues,
  commercialOfferCalculationValues,
} from "@workspace/db";

describe("commercial offer schema", () => {
  it("exports durable owner-controlled commercial offer rules", () => {
    expect(commercialOfferRules.code).toBeDefined();
    expect(commercialOfferRules.sourceDocumentId).toBeDefined();
    expect(commercialOfferRules.requiresOwnerConfirmation).toBeDefined();
    expect(commercialOfferRules.sourceConflictNote).toBeDefined();
  });

  it("keeps the rule vocabulary narrow", () => {
    expect(commercialOfferKindValues).toEqual(["discount", "payment_option", "fee"]);
    expect(commercialOfferStateValues).toEqual(["proposed", "active", "archived"]);
    expect(commercialOfferCalculationValues).toEqual([
      "fixed_cents",
      "percent_basis_points",
      "revenue_share",
      "variable",
    ]);
  });
});
