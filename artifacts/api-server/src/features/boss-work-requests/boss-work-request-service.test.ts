import { describe, expect, it } from "vitest";
import {
  CONVENTION_REVIEW_TEMPLATE_CODES,
  templateFingerprint,
} from "./boss-work-request-service";

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

describe("convention email review set", () => {
  it("uses the explicit seven-template campaign order", () => {
    expect(CONVENTION_REVIEW_TEMPLATE_CODES).toEqual([
      "convention_before_general_v2",
      "convention_before_new_event_v2",
      "convention_before_past_event_v2",
      "convention_during_new_event_v2",
      "convention_during_past_event_v2",
      "convention_after_new_event_v2",
      "convention_after_past_event_v2",
    ]);
  });
});
