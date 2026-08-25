import { describe, expect, it } from "vitest";

import { GoogleValidationManualDecisionOverlay } from "./google-validation-manual-decision-overlay";

const row = (id: string) => ({
  id,
  threadId: `t-${id}`,
  subject: id,
  from: "x@example.com",
  to: "zone@example.com",
  date: "",
  internalDateMs: 1,
  labelIds: [],
  labels: [],
  hasAttachments: false,
  evidenceCodes: ["ai_profile_match"],
  candidates: [],
  matchedContact: null,
  resolvedOrganization: { id: "auto", name: "Automatic Guess" },
  organizationCandidates: [],
});

const result = {
  checkedLimit: 100,
  aiEnabled: false as const,
  historicalImportStarted: false as const,
  validationStatus: "ready_for_review" as const,
  counts: { discovered: 2, matched: 2, needsReview: 0, ignored: 0 },
  matched: [row("corrected"), row("ignored")],
  needsReview: [],
  ignored: [],
};

describe("GoogleValidationManualDecisionOverlay", () => {
  it("moves manually corrected and ignored messages to their durable outcomes", async () => {
    const pool = {
      query: async (text: string) => {
        if (text.includes("FROM google_workspace_connections")) return { rows: [{ id: "conn" }] };
        return { rows: [
          { message_id: "corrected", review_state: "resolved", resolved_organization_id: "right", organization_name: "Right Profile" },
          { message_id: "ignored", review_state: "ignored", resolved_organization_id: null, organization_name: null },
        ] };
      },
    };
    const overlay = new GoogleValidationManualDecisionOverlay(pool as never);

    const updated = await overlay.apply(result);

    expect(updated.matched).toHaveLength(1);
    expect(updated.matched[0]).toMatchObject({
      id: "corrected",
      resolvedOrganization: { id: "right", name: "Right Profile" },
      evidenceCodes: expect.arrayContaining(["manual_profile_assignment"]),
    });
    expect(updated.ignored).toHaveLength(1);
    expect(updated.ignored[0]).toMatchObject({ id: "ignored", resolvedOrganization: null });
    expect(updated.counts).toEqual({ discovered: 2, matched: 1, needsReview: 0, ignored: 1 });
  });
});
