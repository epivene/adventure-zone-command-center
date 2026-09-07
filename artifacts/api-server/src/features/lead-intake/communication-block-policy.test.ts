import { describe, expect, it } from "vitest";
import { APPROVED_LEAD_INTRODUCTION_2026 } from "../communication-templates/lead-introduction-2026-approved";

import { createCommunicationBlockPolicy } from "./communication-block-policy";
import { buildLeadEmailPreview } from "./lead-email-preview-service";

describe("communication block policy and server preview", () => {
  it("uses exact stable targets, retains removal history, and removes idempotently", () => {
    const policy = createCommunicationBlockPolicy();
    const block = policy.create({ targetType: "recipient_email", normalizedEmail: " Person@Example.com ", actorId: "owner", reason: "asked not to receive outreach" });
    expect(policy.create({ targetType: "recipient_email", normalizedEmail: "person@example.com", actorId: "owner", reason: "same" }).id).toBe(block.id);
    expect(policy.isBlocked({ recipientEmail: "PERSON@example.com" })).toBe(true);
    policy.remove(block.id, { actorId: "owner", reason: "permission restored" });
    policy.remove(block.id, { actorId: "owner", reason: "repeated removal" });
    expect(policy.isBlocked({ recipientEmail: "person@example.com" })).toBe(false);
    expect(policy.history(block.id).map((event) => event.action)).toEqual(["created", "removed"]);
  });

  it("withholds normal copy whenever server-owned readiness has a DO NOT SEND blocker", () => {
    const preview = buildLeadEmailPreview({
      lead: { rowId: "row", reviewVersion: 0, profileName: "Fair", eventName: "Fair", eventCity: "Town", eventRegion: "UT", startDate: "2026-09-29", endDate: "2026-09-29", firstName: "Pat", recipientEmail: "pat@example.com", rowState: "verified", recipientConfirmed: true, introductionSuitable: true, relationshipOutcome: "new_introduction", territoryStatus: "open", fitStatus: "approved" },
      blocks: [{ active: true, targetType: "recipient_email", normalizedEmail: "pat@example.com" }],
      approvedTemplate: { templateId: "template-1", code: APPROVED_LEAD_INTRODUCTION_2026.code, version: APPROVED_LEAD_INTRODUCTION_2026.version, sourceDocumentId: "source-1", sourceFilename: APPROVED_LEAD_INTRODUCTION_2026.sourceFilename, reviewedBy: APPROVED_LEAD_INTRODUCTION_2026.reviewedBy, reviewedAt: "2026-08-25T00:00:00.000Z", definition: APPROVED_LEAD_INTRODUCTION_2026 },
      availability: { ready: true, reviewVersion: 0, proposedStartDate: "2026-09-27", proposedEndDate: "2026-09-30", checkedAt: "2026-08-26T12:00:00.000Z", packageAvailability: { status: "resolved", packages: [{ packageKey: "adventure_zone", availableQuantity: 1 }], restrictedOptions: [] } },
      now: new Date("2026-08-26T12:01:00.000Z"),
    });
    expect(preview.readiness).toMatchObject({ ready: false, blockers: ["do_not_send"] });
    expect(preview.subject).toBeNull();
    expect(preview.body).toBeNull();
  });
});
