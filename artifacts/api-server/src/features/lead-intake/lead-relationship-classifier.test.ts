import { describe, expect, it } from "vitest";
import { classifyLeadRelationship, type LeadRelationshipEvidence } from "./lead-relationship-classifier";

const organizationId = "10000000-0000-4000-8000-000000000001";
const recipientEmail = "contact@example.org";
const anchor = new Date("2026-08-25T18:00:00Z");

function evidence(overrides: Partial<LeadRelationshipEvidence> = {}): LeadRelationshipEvidence {
  return {
    evidenceId: "gmail:message-1",
    sourceType: "gmail",
    sourceId: "message-1",
    occurredAt: new Date("2025-05-14T12:00:00Z"),
    direction: "inbound",
    responseProven: true,
    organizationId,
    contactId: null,
    recipientEmail,
    excerpt: "Confirmed reply",
    conflicting: false,
    ...overrides,
  };
}

describe("classifyLeadRelationship", () => {
  it("treats a verified inbound response on the three-year cutoff as returning", () => {
    expect(classifyLeadRelationship({
      organizationId,
      recipientEmail,
      anchor,
      evidence: [evidence({ occurredAt: new Date("2023-08-25T00:00:00Z") })],
    })).toMatchObject({
      outcome: "returning_contact",
      cutoffDate: "2023-08-25",
      latestVerifiedResponseAt: new Date("2023-08-25T00:00:00Z"),
      reviewRequired: false,
    });
  });

  it("treats a verified inbound response before the cutoff as reintroduction", () => {
    expect(classifyLeadRelationship({
      organizationId,
      recipientEmail,
      anchor,
      evidence: [evidence({ occurredAt: new Date("2023-08-24T23:59:59Z") })],
    }).outcome).toBe("reintroduction");
  });

  it("uses prior outreach when only verified-recipient outbound evidence exists", () => {
    expect(classifyLeadRelationship({
      organizationId,
      recipientEmail,
      anchor,
      evidence: [evidence({ direction: "outbound", responseProven: false })],
    })).toMatchObject({
      outcome: "prior_outreach_no_response",
      latestOutboundAt: new Date("2025-05-14T12:00:00Z"),
      latestVerifiedResponseAt: null,
      reviewRequired: false,
    });
  });

  it("uses a new introduction when there is no evidence", () => {
    expect(classifyLeadRelationship({ organizationId, recipientEmail, anchor, evidence: [] }))
      .toEqual({
        outcome: "new_introduction",
        cutoffDate: "2023-08-25",
        evidenceIds: [],
        latestOutboundAt: null,
        latestVerifiedResponseAt: null,
        reviewRequired: false,
      });
  });

  it.each([
    ["unknown direction", evidence({ direction: "unknown", responseProven: false })],
    ["source conflict", evidence({ conflicting: true })],
    ["other organization", evidence({ organizationId: "10000000-0000-4000-8000-000000000002" })],
    ["other recipient", evidence({ recipientEmail: "other@example.org" })],
    ["unmatched recipient", evidence({ recipientEmail: null })],
    ["invalid response direction", evidence({ direction: "outbound", responseProven: true })],
  ])("requires review for %s", (_label, observation) => {
    expect(classifyLeadRelationship({ organizationId, recipientEmail, anchor, evidence: [observation] }))
      .toMatchObject({ outcome: "needs_review", reviewRequired: true });
  });

  it("deduplicates identical source observations and keeps stable evidence ids", () => {
    const result = classifyLeadRelationship({
      organizationId,
      recipientEmail: "CONTACT@example.org",
      anchor,
      evidence: [
        evidence({ evidenceId: "gmail:z", recipientEmail: "contact@EXAMPLE.org" }),
        evidence({ evidenceId: "gmail:a", recipientEmail: "contact@example.org" }),
        evidence({ evidenceId: "crm:activity-2", sourceType: "crm", sourceId: "activity-2", direction: "outbound", responseProven: false }),
      ],
    });

    expect(result.evidenceIds).toEqual(["crm:activity-2", "gmail:a"]);
    expect(result.outcome).toBe("returning_contact");
  });

  it("requires review when duplicate source observations disagree", () => {
    const result = classifyLeadRelationship({
      organizationId,
      recipientEmail,
      anchor,
      evidence: [evidence(), evidence({ evidenceId: "gmail:duplicate", direction: "outbound", responseProven: false })],
    });

    expect(result).toMatchObject({ outcome: "needs_review", reviewRequired: true });
  });
});
