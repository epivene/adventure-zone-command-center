import { describe, expect, it } from "vitest";
import {
  buildOrganizerFeedbackEmail,
  hashOrganizerFeedbackToken,
  organizerFeedbackSubmissionSchema,
  toManagerOrganizerFeedback,
} from "./organizer-feedback-domain";

describe("organizer feedback domain", () => {
  it("validates every rating as 1-5 and invite-back as yes/maybe/no", () => {
    expect(
      organizerFeedbackSubmissionSchema.safeParse({
        overallRating: 5,
        professionalismRating: 4,
        setupRating: 3,
        communicationRating: 5,
        inviteBack: "yes",
        comments: "Great crew.",
      }).success,
    ).toBe(true);

    expect(
      organizerFeedbackSubmissionSchema.safeParse({
        overallRating: 6,
        professionalismRating: 4,
        setupRating: 3,
        communicationRating: 5,
        inviteBack: "yes",
      }).success,
    ).toBe(false);
  });

  it("hashes opaque review tokens before persistence", () => {
    expect(hashOrganizerFeedbackToken("secret-review-token")).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOrganizerFeedbackToken("secret-review-token")).not.toContain("secret-review-token");
  });

  it("builds a branded email with five star links and a fallback CTA", () => {
    const email = buildOrganizerFeedbackEmail({
      eventName: "Test County Fair",
      eventDateLabel: "Sept. 12-13, 2026",
      managerName: "Kristy",
      reviewUrl: "https://example.com/review/abc",
    });

    expect(email.subject).toContain("Test County Fair");
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(email.html).toContain(`?overall=${rating}`);
    }
    expect(email.html).toContain("Leave Your Review");
    expect(email.text).toContain("https://example.com/review/abc");
  });

  it("never exposes admin-only notes to a manager", () => {
    const managerView = toManagerOrganizerFeedback({
      id: "review-1",
      bookingId: "booking-1",
      legId: "leg-1",
      eventName: "Test Fair",
      eventDateLabel: "Sept. 12, 2026",
      overallRating: 5,
      professionalismRating: 5,
      setupRating: 4,
      communicationRating: 5,
      inviteBack: "yes",
      comments: "Wonderful.",
      submittedAt: "2026-09-14T12:00:00.000Z",
      adminNotes: "Private owner note",
      managerAcknowledgedAt: null,
      managerResponse: null,
      managerRespondedAt: null,
    });

    expect(managerView).not.toHaveProperty("adminNotes");
    expect(JSON.stringify(managerView)).not.toContain("Private owner note");
  });
});
