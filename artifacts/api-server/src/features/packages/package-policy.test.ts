import { describe, expect, it } from "vitest";

import {
  getAttractionTotalPolicy,
  validateSharedAttractionTotal,
} from "./package-policy";
import type { PackageTemplateSummary } from "./package-types";

function packageTemplate(
  overrides: Partial<PackageTemplateSummary> & Pick<PackageTemplateSummary, "name">,
): PackageTemplateSummary {
  return {
    id: overrides.id ?? overrides.name.toLowerCase().replaceAll(" ", "-"),
    code: overrides.code ?? overrides.name.toLowerCase().replaceAll(" ", "_"),
    name: overrides.name,
    baseAttractionCount: overrides.baseAttractionCount ?? 10,
    minimumAttractionCount: overrides.minimumAttractionCount ?? 10,
    maximumAttractionCount: overrides.maximumAttractionCount ?? 12,
  };
}

describe("package attraction guidance", () => {
  it("uses the editable Adventure Zone 10-12 guideline", () => {
    const policy = getAttractionTotalPolicy([
      packageTemplate({ name: "Adventure Zone" }),
    ]);

    expect(policy).toEqual({
      suggested: 10,
      minimum: 10,
      maximum: 12,
      advisoryMessage: null,
    });
  });

  it("supports exact editable defaults for Warrior's Playground and Pirate's Rebellion", () => {
    expect(
      getAttractionTotalPolicy([
        packageTemplate({
          name: "Warrior's Playground",
          baseAttractionCount: 5,
          minimumAttractionCount: 5,
          maximumAttractionCount: 5,
        }),
      ]),
    ).toMatchObject({ suggested: 5, minimum: 5, maximum: 5 });

    expect(
      getAttractionTotalPolicy([
        packageTemplate({
          name: "Pirate's Rebellion",
          baseAttractionCount: 3,
          minimumAttractionCount: 3,
          maximumAttractionCount: 3,
        }),
      ]),
    ).toMatchObject({ suggested: 3, minimum: 3, maximum: 3 });
  });

  it("derives multi-package guidance from the selected templates instead of hard-coding 10-12", () => {
    const policy = getAttractionTotalPolicy([
      packageTemplate({ name: "Adventure Zone" }),
      packageTemplate({
        name: "Pirate's Rebellion",
        baseAttractionCount: 3,
        minimumAttractionCount: 3,
        maximumAttractionCount: 4,
      }),
    ]);

    expect(policy).toMatchObject({
      suggested: 13,
      minimum: 13,
      maximum: 16,
    });
  });

  it("allows legitimate totals outside the guideline without an approval reason", () => {
    const packages = [packageTemplate({ name: "Adventure Zone" })];

    expect(
      validateSharedAttractionTotal({
        packages,
        physicalAttractionTotal: 14,
        approvalReason: null,
      }),
    ).toEqual({ ok: true, value: undefined });

    expect(
      validateSharedAttractionTotal({
        packages,
        physicalAttractionTotal: 9,
        approvalReason: null,
      }),
    ).toEqual({ ok: true, value: undefined });
  });

  it("still requires a physical total when a package is selected", () => {
    expect(
      validateSharedAttractionTotal({
        packages: [packageTemplate({ name: "Adventure Zone" })],
        physicalAttractionTotal: null,
        approvalReason: null,
      }),
    ).toEqual({ ok: false, error: { code: "TOTAL_REQUIRED" } });
  });
});
