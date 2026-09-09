import { describe, expect, it } from "vitest";
import { templateFingerprint } from "./boss-work-request-service";
import { requestTypeSchema } from "./boss-work-request-types";

describe("templateFingerprint", () => {
  it("changes for subject, body, format, or version", () => {
    const base = { templateVersion: "1", subjectTemplate: "Hello", bodyTemplate: "Body", bodyFormat: "plain_text" as const };
    const fingerprint = templateFingerprint(base);
    expect(templateFingerprint({ ...base })).toBe(fingerprint);
    expect(templateFingerprint({ ...base, bodyTemplate: "Changed" })).not.toBe(fingerprint);
    expect(templateFingerprint({ ...base, bodyFormat: "html" })).not.toBe(fingerprint);
    expect(templateFingerprint({ ...base, templateVersion: "2" })).not.toBe(fingerprint);
  });
});

describe("Dave workspace input types", () => {
  it("accepts the convention planning questionnaire as a real work request", () => {
    expect(requestTypeSchema.parse("convention_planning_questionnaire"))
      .toBe("convention_planning_questionnaire");
  });
});
