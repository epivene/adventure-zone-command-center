import { describe, expect, it } from "vitest";

import {
  COMMUNICATION_TEMPLATE_SEEDS,
} from "./communication-template-seed";
import {
  allowedTemplatePlaceholders,
  extractTemplateTokens,
} from "./communication-template-renderer";

describe("communication template seed corpus", () => {
  it("ships only reviewed active scopes from the approved corpus", () => {
    expect(COMMUNICATION_TEMPLATE_SEEDS).toHaveLength(18);
    expect(
      COMMUNICATION_TEMPLATE_SEEDS.every((template) =>
        ["active", "reviewed"].includes(template.state),
      ),
    ).toBe(true);
    expect(
      COMMUNICATION_TEMPLATE_SEEDS.find(
        (template) => template.code === "internal_coi_request",
      )?.accessScope,
    ).toBe("owner");
    expect(
      COMMUNICATION_TEMPLATE_SEEDS.find(
        (template) => template.code === "ride_inspector_request",
      )?.accessScope,
    ).toBe("owner");
  });

  it("contains no hard-coded Amy or Dave signatures", () => {
    for (const template of COMMUNICATION_TEMPLATE_SEEDS) {
      expect(template.bodyTemplate).not.toMatch(/\bAmy\b|\bDave\b|\bDavid Gordon\b/);
    }
  });

  it("keeps payment arrangements conditional", () => {
    const mini = COMMUNICATION_TEMPLATE_SEEDS.find(
      (template) => template.code === "mini_zone_option",
    );
    expect(mini?.bodyTemplate).toContain(
      "must be confirmed before we promise them",
    );
  });

  it("uses only approved placeholders", () => {
    for (const template of COMMUNICATION_TEMPLATE_SEEDS) {
      const tokens = extractTemplateTokens(
        `${template.subjectTemplate ?? ""}\n${template.bodyTemplate}`,
      );
      for (const token of tokens) {
        expect(allowedTemplatePlaceholders).toContain(token);
      }
    }
  });
});
