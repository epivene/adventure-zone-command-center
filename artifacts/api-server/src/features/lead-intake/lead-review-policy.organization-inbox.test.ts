import { describe, expect, it } from "vitest";

import { evaluateLeadReview } from "./lead-review-policy";

const validDecision = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactMode: "organization_inbox",
  contactId: null,
  contactName: "",
  contactRole: "",
  recipientEmail: "societyhall@gmail.com",
  recipientConfirmed: true,
  recipientConflictResolved: false,
  introductionSuitable: true,
  eventName: "Alamosa ARTs Festival (Alamosa) CO",
  startDate: "2026-09-05",
  endDate: "2026-09-05",
  emailEvidence: { sourceKind: "act_description", sourceReference: "act:source-1:version:version-1:path:$.Description" },
  dateEvidence: { sourceKind: "official_website", sourceReference: "https://example.com/event" },
};

describe("organization inbox lead review", () => {
  it("verifies an organization inbox without a fabricated person", () => {
    expect(evaluateLeadReview(validDecision as never)).toEqual({ verified: true, blockers: [] });
  });

  it.each([
    ["contact id", { contactId: "20000000-0000-4000-8000-000000000001" }],
    ["contact name", { contactName: "Made Up Person" }],
    ["contact role", { contactRole: "Made Up Role" }],
  ])("blocks organization inboxes containing a %s", (_label, change) => {
    expect(evaluateLeadReview({ ...validDecision, ...change } as never).blockers)
      .toContain("organization_inbox_person_fields_present");
  });

  it("still requires recipient and suitability confirmations", () => {
    expect(evaluateLeadReview({ ...validDecision, recipientConfirmed: false, introductionSuitable: false } as never).blockers)
      .toEqual(expect.arrayContaining(["recipient_confirmation_required", "introduction_suitability_required"]));
  });
});
