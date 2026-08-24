import { describe, expect, it } from "vitest";

import { validateAuthoredTemplateText } from "./communication-template-authoring";

describe("validateAuthoredTemplateText", () => {
  it("accepts approved protected placeholders and returns normalized metadata", () => {
    expect(validateAuthoredTemplateText({
      subjectTemplate: "Hi {{contactName}}",
      bodyTemplate: "We'd love to come to {{eventName}} in {{eventCity}}.",
    })).toEqual({ placeholders: ["contactName", "eventName", "eventCity"] });
  });

  it.each([
    "Hi {{contacName}}",
    "Hi {{favoriteColor}}",
    "Hi {{contactName}",
    "Hi contactName}}",
    "Hi {{ contactName }}",
  ])("rejects malformed or unknown placeholder content: %s", (bodyTemplate) => {
    expect(() => validateAuthoredTemplateText({ subjectTemplate: null, bodyTemplate }))
      .toThrow("INVALID_TEMPLATE_PLACEHOLDER");
  });

  it("deduplicates placeholders in first-use order", () => {
    expect(validateAuthoredTemplateText({
      subjectTemplate: "{{eventName}}",
      bodyTemplate: "{{contactName}} {{eventName}} {{contactName}}",
    }).placeholders).toEqual(["eventName", "contactName"]);
  });
});
