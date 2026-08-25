import { describe, expect, it } from "vitest";
import { evaluateLeadReview, type LeadReviewDecision } from "./lead-review-policy";

const valid: LeadReviewDecision = {
  organizationId: "10000000-0000-4000-8000-000000000001",
  contactMode: "manual",
  contactId: null,
  contactName: "Lindsey",
  contactRole: "Event organizer",
  recipientEmail: "lilupow@aspenfilm.org",
  recipientConfirmed: true,
  introductionSuitable: true,
  eventName: "Aspen Filmfest (Aspen) CO",
  startDate: "2026-09-29",
  endDate: "2026-10-04",
  emailEvidence: { sourceKind: "official_website", sourceReference: "https://aspenfilm.org/contact" },
  dateEvidence: { sourceKind: "official_website", sourceReference: "https://aspenfilm.org/festival" },
  recipientConflictResolved: false,
};

describe("evaluateLeadReview", () => {
  it("requires complete 2026 event dates and rejects an inverted range", () => {
    expect(evaluateLeadReview({ ...valid, startDate: "", endDate: "" }).blockers).toContain("event_dates_required");
    expect(evaluateLeadReview({ ...valid, startDate: "2026-10-05", endDate: "2026-10-04" }).blockers).toContain("event_date_range_invalid");
    expect(evaluateLeadReview({ ...valid, startDate: "2027-09-29", endDate: "2027-10-04" }).blockers).toContain("event_year_not_2026");
    expect(evaluateLeadReview({ ...valid, startDate: "2026-08-31", endDate: "2026-09-02" }).blockers).toContain("event_outside_september_october");
    expect(evaluateLeadReview({ ...valid, startDate: "2026-10-30", endDate: "2026-11-01" }).blockers).toContain("event_outside_september_october");
  });

  it("does not approve a suggested website email until the reviewer confirms it", () => {
    const result = evaluateLeadReview({ ...valid, recipientConfirmed: false });
    expect(result).toEqual(expect.objectContaining({ verified: false }));
    expect(result.blockers).toContain("recipient_confirmation_required");
  });

  it("requires one deliberate choice when candidate emails conflict", () => {
    const candidates = ["events@aspenfilm.org", "lilupow@aspenfilm.org"];
    expect(evaluateLeadReview({ ...valid, candidateEmails: candidates, recipientEmail: "third@example.com" }).blockers)
      .toContain("recipient_conflict_unresolved");
    expect(evaluateLeadReview({ ...valid, candidateEmails: candidates, recipientEmail: "third@example.com", recipientConflictResolved: true }).verified)
      .toBe(true);
    expect(evaluateLeadReview({ ...valid, candidateEmails: candidates }).verified).toBe(true);
  });

  it("requires an existing contact to belong to the selected profile", () => {
    const result = evaluateLeadReview({
      ...valid,
      contactMode: "existing",
      contactId: "20000000-0000-4000-8000-000000000001",
      contactBelongsToOrganization: false,
      contactEmailMatchesRecipient: false,
    });
    expect(result.blockers).toContain("contact_profile_mismatch");
  });

  it("returns verified only after profile, role, recipient, suitability, and evidence are explicit", () => {
    expect(evaluateLeadReview(valid)).toEqual({ verified: true, blockers: [] });
    expect(evaluateLeadReview({ ...valid, contactRole: "" }).blockers).toContain("contact_role_required");
    expect(evaluateLeadReview({ ...valid, introductionSuitable: false }).blockers).toContain("introduction_suitability_required");
    expect(evaluateLeadReview({ ...valid, dateEvidence: { ...valid.dateEvidence, sourceReference: "" } }).blockers).toContain("date_evidence_required");
  });
});
