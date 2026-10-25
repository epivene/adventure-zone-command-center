import { describe, expect, it } from "vitest";
import { suggestSentFollowUp } from "./sent-email-follow-up";
const sentAt = new Date("2026-10-24T16:00Z");
describe("sent email follow-up defaults", () => {
  it.each([
    ["quote", "2026-10-28T16:00:00.000Z"],
    ["availability", "2026-10-28T16:00:00.000Z"],
    ["normal", "2026-10-31T16:00:00.000Z"],
    ["post_event", "2026-11-14T16:00:00.000Z"],
  ] as const)("uses the %s cadence", (purpose, expected) =>
    expect(suggestSentFollowUp({ purpose, sentAt })).toBe(expected),
  );
  it("respects an explicit override", () =>
    expect(
      suggestSentFollowUp({
        purpose: "quote",
        sentAt,
        overrideDueAt: "2026-11-20T16:00:00Z",
      }),
    ).toBe("2026-11-20T16:00:00.000Z"));
});
