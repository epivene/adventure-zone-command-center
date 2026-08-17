import { describe, expect, it } from "vitest";

import { reviewDisplay, shouldDropLinkedToReview } from "./review-cleanup";

describe("ACT recovery review cleanup", () => {
  it("drops linked-to bookkeeping including the parenthesized ACT form", () => {
    expect(shouldDropLinkedToReview({
      streamType: "history",
      rawSnapshot: { regarding: "(Linked to)", details: "Linked to company Summer Fair" },
    })).toBe(true);
    expect(shouldDropLinkedToReview({
      streamType: "history",
      rawSnapshot: { regarding: "Linked to company Summer Fair" },
    })).toBe(true);
  });

  it("does not drop a meaningful message just because it contains the words linked to", () => {
    expect(shouldDropLinkedToReview({
      streamType: "history",
      rawSnapshot: { details: "I emailed the organizer and linked to the application page for reference." },
    })).toBe(false);
  });

  it("converts ACT/Gmail HTML to readable review text", () => {
    const display = reviewDisplay({
      streamType: "history",
      rawSnapshot: {
        regarding: "<b>E-mail sent</b>",
        details: "<div>Hello Amy,<br>Proposal package sent.</div>",
      },
    });

    expect(display.subject).toBe("E-mail sent");
    expect(display.body).toBe("Hello Amy,\nProposal package sent.");
  });
});
