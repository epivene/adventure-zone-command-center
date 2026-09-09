import { describe, expect, it } from "vitest";
import { templateFingerprint } from "./boss-work-request-service";

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
