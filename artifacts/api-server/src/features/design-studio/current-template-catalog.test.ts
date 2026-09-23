import { describe, expect, it } from "vitest";

import {
  CONTRACT_ARRANGEMENTS,
  CONTRACT_PACKAGE_SELECTIONS,
  CURRENT_CONTRACT_TEMPLATES,
  CURRENT_EMAIL_TEMPLATES,
  CURRENT_PROPOSAL_TEMPLATES,
} from "./current-template-catalog";

describe("current Design Studio catalog", () => {
  it("contains the complete approved inventory", () => {
    expect(CURRENT_EMAIL_TEMPLATES).toHaveLength(14);
    expect(CURRENT_CONTRACT_TEMPLATES).toHaveLength(
      CONTRACT_ARRANGEMENTS.length * CONTRACT_PACKAGE_SELECTIONS.length,
    );
    expect(CURRENT_CONTRACT_TEMPLATES).toHaveLength(15);
    expect(CURRENT_PROPOSAL_TEMPLATES).toHaveLength(7);
    expect(new Set(CURRENT_EMAIL_TEMPLATES.map((item) => item.code)).size).toBe(14);
    expect(new Set(CURRENT_CONTRACT_TEMPLATES.map((item) => item.catalogKey)).size).toBe(15);
  });

  it("keeps footprints out of standard contracts", () => {
    for (const template of CURRENT_CONTRACT_TEMPLATES) {
      expect(template.content).not.toMatch(/sq\s*ft|square feet|footprint/i);
    }
  });

  it("keeps Foam Party an optional add-on", () => {
    for (const template of CURRENT_CONTRACT_TEMPLATES) {
      const parsed = JSON.parse(template.content);
      expect(parsed.optionalAddOns).toEqual([
        { code: "foam_party", price: "{{foam_party_price}}", selected: false },
      ]);
      expect(parsed.packageCode).not.toBe("foam_party");
    }
  });

  it("uses flexible insurance wording and no em dashes in email copy", () => {
    const copy = JSON.stringify(CURRENT_EMAIL_TEMPLATES);
    expect(copy).not.toContain("—");
    expect(copy).not.toMatch(/\$?2[, ]?million/i);
  });
});
