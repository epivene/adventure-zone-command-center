import { describe, expect, it } from "vitest";

import { gmailSentWindowQuery } from "./google-sent-profile-link-sweep-service";

describe("gmailSentWindowQuery", () => {
  it("adds one calendar day of search slack around an exact UTC audit window", () => {
    expect(gmailSentWindowQuery(
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2027-01-01T00:00:00.000Z"),
    )).toBe(
      "in:sent after:2025/12/31 before:2027/01/02 -in:trash -in:spam",
    );
  });

  it("uses UTC calendar dates so server timezone cannot shift the audit", () => {
    expect(gmailSentWindowQuery(
      new Date("2026-08-15T18:30:00.000Z"),
      new Date("2026-08-31T22:45:00.000Z"),
    )).toBe(
      "in:sent after:2026/08/14 before:2026/09/01 -in:trash -in:spam",
    );
  });
});
