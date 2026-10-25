import { describe, expect, it } from "vitest";
import { mountainInput, mountainInstant } from "./follow-up-time";
describe("follow-up Mountain input", () => {
  it("round trips winter and summer offsets", () => {
    expect(mountainInstant("2026-10-24T09:00")).toBe(
      "2026-10-24T15:00:00.000Z",
    );
    expect(mountainInstant("2026-12-24T09:00")).toBe(
      "2026-12-24T16:00:00.000Z",
    );
    expect(mountainInput("2026-12-24T16:00:00Z")).toBe("2026-12-24T09:00");
  });
  it("rejects nonexistent spring-forward times", () => {
    expect(() => mountainInstant("2027-03-14T02:30")).toThrow(/does not exist/);
  });
});
