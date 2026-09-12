import { describe, expect, it } from "vitest";

import { renderCommunicationTemplateText } from "./communication-template-renderer";

describe("HTML communication template rendering", () => {
  it("escapes placeholder markup and removes unsafe resolved destinations", () => {
    const rendered = renderCommunicationTemplateText({
      templateId: "security-test",
      subjectTemplate: "Hello {{contactName}}",
      bodyTemplate: '<p>Hello {{contactName}}</p><a href="{{additionalInsuredInfo}}">Open</a>',
      bodyFormat: "html",
      requiredPlaceholders: ["contactName"],
      values: {
        contactName: '<img src=x onerror="alert(1)">',
        additionalInsuredInfo: "javascript:alert(1)",
      },
    });

    expect(rendered.subject).toBe('Hello <img src=x onerror="alert(1)">');
    expect(rendered.body).toContain("&lt;img");
    expect(rendered.body).not.toMatch(/<img|href="javascript:|onerror=/i);
  });
});
