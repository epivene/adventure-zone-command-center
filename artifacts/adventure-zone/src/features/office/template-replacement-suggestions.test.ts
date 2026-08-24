import { describe, expect, it } from "vitest";

import { suggestTemplateReplacements } from "./template-replacement-suggestions";

describe("suggestTemplateReplacements", () => {
  it("suggests current contact and event literals that appear in the draft", () => {
    expect(suggestTemplateReplacements({
      subject: "Adventure Zone for Apple Festival",
      body: "Hi Judith, we'd love to come to Apple Festival in Logan.",
      context: { contactName: "Judith", eventName: "Apple Festival", eventCity: "Logan" },
    })).toEqual(expect.arrayContaining([
      expect.objectContaining({ literal: "Judith", token: "contactName" }),
      expect.objectContaining({ literal: "Apple Festival", token: "eventName" }),
      expect.objectContaining({ literal: "Logan", token: "eventCity" }),
    ]));
  });

  it("does not suggest blank values or substrings inside unrelated words", () => {
    expect(suggestTemplateReplacements({
      subject: "Catalog",
      body: "The catalog is ready.",
      context: { contactName: "Cat", eventName: "" },
    })).toEqual([]);
  });
});
