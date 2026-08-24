import { describe, expect, it } from "vitest";

import {
  appendTemplateToken,
  parseTemplateSegments,
  serializeTemplateSegments,
} from "./template-authoring";

describe("Office template segment authoring", () => {
  it("parses and serializes protected tokens losslessly", () => {
    const segments = parseTemplateSegments("Hi {{contactName}}, welcome to {{eventName}}.");
    expect(segments).toEqual([
      { kind: "text", value: "Hi " },
      { kind: "token", token: "contactName" },
      { kind: "text", value: ", welcome to " },
      { kind: "token", token: "eventName" },
      { kind: "text", value: "." },
    ]);
    expect(serializeTemplateSegments(segments)).toBe("Hi {{contactName}}, welcome to {{eventName}}.");
  });

  it("rejects unknown serialized fields instead of converting them to ordinary text", () => {
    expect(() => parseTemplateSegments("Hi {{favoriteColor}}"))
      .toThrow("INVALID_TEMPLATE_PLACEHOLDER");
  });

  it("appends only approved token names", () => {
    expect(appendTemplateToken("Hi ", "contactName")).toBe("Hi {{contactName}}");
  });
});
