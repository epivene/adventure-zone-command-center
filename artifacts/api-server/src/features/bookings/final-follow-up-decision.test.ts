import { describe, expect, it } from "vitest";
import { finalFollowUpDecision } from "./final-follow-up-decision";
const now = new Date("2026-10-24T16:00Z");
describe("final booking follow-up decision", () => {
  it.each(["confirmed", "declined", "cancelled", "completed"])(
    "requires a final decision when changing to %s",
    (status) =>
      expect(() => finalFollowUpDecision("contacted", status, {}, now)).toThrow(
        /next action|reason/,
      ),
  );
  it("allows an explicit no-further-action reason", () =>
    expect(
      finalFollowUpDecision(
        "contacted",
        "declined",
        { finalNoFurtherActionReason: "Organizer declined this season" },
        now,
      ),
    ).toEqual({ kind: "none", reason: "Organizer declined this season" }));
  it("allows a future final follow-up", () =>
    expect(
      finalFollowUpDecision(
        "contacted",
        "confirmed",
        {
          finalNextActionKind: "Check deposit",
          finalNextActionDueAt: new Date("2026-10-28T16:00Z"),
        },
        now,
      ),
    ).toMatchObject({ kind: "schedule", action: "Check deposit" }));
  it("does not require a fresh decision for unrelated edits", () =>
    expect(
      finalFollowUpDecision("confirmed", "confirmed", {}, now),
    ).toBeNull());
});
