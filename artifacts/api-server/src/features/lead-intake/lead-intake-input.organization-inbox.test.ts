import { describe, expect, it } from "vitest";
import { leadReviewConfirmationSchema } from "./lead-intake-input";

describe("leadReviewConfirmationSchema organization inbox", () => {
  it("accepts organization_inbox as an explicit recipient mode", () => {
    const result = leadReviewConfirmationSchema.safeParse({
      expectedVersion: 0,
      decision: {
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
        emailEvidence: {
          sourceKind: "act_description",
          sourceReference: "act:source-1:version:version-1:path:$.Description",
        },
        dateEvidence: {
          sourceKind: "official_website",
          sourceReference: "https://example.org/2026-event",
        },
      },
    });

    expect(result.success).toBe(true);
  });
});
