import { describe, expect, it } from "vitest";

import {
  normalizeContactEmailValue,
  normalizeSendableContactEmail,
} from "./contact-email-value";

describe("contact email values", () => {
  it("normalizes any manually stored contact value", () => {
    expect(normalizeContactEmailValue(" Information@RockyMountainTrainShow.com "))
      .toBe("information@rockymountaintrainshow.com");
    expect(normalizeContactEmailValue(" Use the website contact form "))
      .toBe("use the website contact form");
  });

  it("only returns values that can be used as email recipients", () => {
    expect(normalizeSendableContactEmail(" Information@RockyMountainTrainShow.com "))
      .toBe("information@rockymountaintrainshow.com");
    expect(normalizeSendableContactEmail("Use the website contact form")).toBeNull();
    expect(normalizeSendableContactEmail(null)).toBeNull();
  });
});
