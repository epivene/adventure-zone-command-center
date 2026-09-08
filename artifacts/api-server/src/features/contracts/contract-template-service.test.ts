import { describe, expect, it } from "vitest";

import { contractTemplateV1 } from "./contract-template-v1";
import { activateTemplate, selectActiveTemplate } from "./contract-template-service";

describe("contract template service", () => {
  it("selects the highest active version while older versions remain addressable", () => {
    const templates = [
      { ...contractTemplateV1, version: 1, state: "retired" as const },
      { ...contractTemplateV1, version: 2, state: "active" as const },
    ];
    expect(selectActiveTemplate(templates, "adventure-zone-standard").version).toBe(2);
    expect(templates.find((template) => template.version === 1)).toBeDefined();
  });

  it("refuses to activate legal copy that has not been reviewed", () => {
    expect(() => activateTemplate({ ...contractTemplateV1, state: "draft" })).toThrow("CONTRACT_TEMPLATE_REVIEW_REQUIRED");
  });

  it("retains provenance for both source agreements", () => {
    expect(contractTemplateV1.sourceProvenance).toEqual(expect.arrayContaining([
      expect.objectContaining({ filename: "Meeteetse Annual Labor Day Celebration 2026 Contract.docx", messageId: "1a048f5b4dab9d4f" }),
      expect.objectContaining({ filename: "Stone Age Stampede Dinosaur CO 2026.docx", messageId: "19c35c5a26d576ad" }),
    ]));
  });
});
