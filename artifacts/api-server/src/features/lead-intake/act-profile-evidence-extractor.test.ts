import { describe, expect, it } from "vitest";

import { extractActProfileTextEvidence } from "./act-profile-evidence-extractor";

const source = {
  sourceRecordId: "11111111-1111-4111-8111-111111111111",
  sourceVersionId: "22222222-2222-4222-8222-222222222222",
};

describe("extractActProfileTextEvidence", () => {
  it("extracts the Alamosa description and normalizes its email", () => {
    expect(extractActProfileTextEvidence(
      { Description: "Society Hall Annual Celebration | Societyhall@gmail.com" },
      source,
    )).toEqual([{
      ...source,
      sourcePath: "$.Description",
      kind: "description",
      originalText: "Society Hall Annual Celebration | Societyhall@gmail.com",
      emails: ["societyhall@gmail.com"],
    }]);
  });

  it("accepts nested description and business-card property names", () => {
    expect(extractActProfileTextEvidence({
      company: {
        companyDescription: "First@Example.com and first@example.com",
        customBusiness_Card: "Office: hello@example.org",
      },
    }, source)).toEqual([
      {
        ...source,
        sourcePath: "$.company.companyDescription",
        kind: "description",
        originalText: "First@Example.com and first@example.com",
        emails: ["first@example.com"],
      },
      {
        ...source,
        sourcePath: "$.company.customBusiness_Card",
        kind: "business_card",
        originalText: "Office: hello@example.org",
        emails: ["hello@example.org"],
      },
    ]);
  });

  it("walks arrays while retaining an exact source path", () => {
    expect(extractActProfileTextEvidence({
      customFields: [{ Description: "events@example.net" }],
    }, source)).toEqual([{
      ...source,
      sourcePath: "$.customFields[0].Description",
      kind: "description",
      originalText: "events@example.net",
      emails: ["events@example.net"],
    }]);
  });

  it("does not promote emails from unrelated text properties", () => {
    expect(extractActProfileTextEvidence({
      Notes: "unverified@example.com",
      displayName: "Alamosa ARTs Festival",
    }, source)).toEqual([]);
  });

  it("keeps eligible text when it contains no valid email", () => {
    expect(extractActProfileTextEvidence({
      Description: "Call us, but this is not an address: hello@invalid",
    }, source)).toEqual([{
      ...source,
      sourcePath: "$.Description",
      kind: "description",
      originalText: "Call us, but this is not an address: hello@invalid",
      emails: [],
    }]);
  });

  it("ignores blank eligible values and non-object input", () => {
    expect(extractActProfileTextEvidence({ Description: "  " }, source)).toEqual([]);
    expect(extractActProfileTextEvidence(null, source)).toEqual([]);
    expect(extractActProfileTextEvidence("Description: person@example.com", source)).toEqual([]);
  });
});
