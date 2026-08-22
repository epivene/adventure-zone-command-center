import { describe, expect, it } from "vitest";

import {
  allowedTemplatePlaceholders,
  extractTemplateTokens,
  renderCommunicationTemplateText,
  validateTemplatePlaceholders,
} from "./communication-template-renderer";

describe("communication template renderer", () => {
  it("renders reviewed package price and duration formatting", () => {
    const rendered = renderCommunicationTemplateText({
      templateId: "template-1",
      subjectTemplate: "{{packageName}} for {{eventName}}",
      bodyTemplate:
        "Hi {{contactName}}, {{packageName}} starts at {{packagePrice}} for {{packageDuration}}. Thanks, {{senderName}}",
      requiredPlaceholders: [
        "contactName",
        "eventName",
        "packageName",
        "packagePrice",
        "packageDuration",
        "senderName",
      ],
      values: {
        contactName: "Jordan",
        eventName: "Sample Fair",
        packageName: "Adventure Zone",
        packagePrice: "$9,000",
        packageDuration: "1–4 days",
        senderName: "Booking Team",
      },
    });

    expect(rendered.subject).toBe("Adventure Zone for Sample Fair");
    expect(rendered.body).toContain("$9,000");
    expect(rendered.body).toContain("1–4 days");
    expect(rendered.missingRequiredFields).toEqual([]);
  });

  it("reports missing required placeholders without destroying the draft text", () => {
    const rendered = renderCommunicationTemplateText({
      templateId: "template-2",
      subjectTemplate: "The Adventure Zone for {{eventName}}",
      bodyTemplate: "Hi {{contactName}},\n\nThanks,\n{{senderName}}",
      requiredPlaceholders: ["contactName", "eventName", "senderName"],
      values: { contactName: "Jordan", eventName: "", senderName: "Booking Team" },
    });

    expect(rendered.missingRequiredFields).toEqual(["eventName"]);
    expect(rendered.subject).toBe("The Adventure Zone for {{eventName}}");
  });

  it("rejects unknown placeholders", () => {
    expect(() => validateTemplatePlaceholders("Hello {{mysteryField}}"))
      .toThrow(/mysteryField/);
  });

  it("supports every approved corpus placeholder", () => {
    expect(allowedTemplatePlaceholders).toEqual(
      expect.arrayContaining([
        "contactName",
        "eventName",
        "eventCity",
        "eventState",
        "eventDates",
        "senderName",
        "senderPhone",
        "senderEmail",
        "packageName",
        "packagePrice",
        "packageDuration",
        "followUpDate",
        "conventionName",
        "additionalInsuredWording",
        "additionalInsuredInfo",
      ]),
    );
    expect(extractTemplateTokens("{{contactName}} {{eventName}} {{contactName}}"))
      .toEqual(["contactName", "eventName"]);
  });
});
