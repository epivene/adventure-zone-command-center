import { describe, expect, it, vi } from "vitest";
import { createLeadIntakeClient } from "./lead-intake-client";

describe("lead profile evidence client", () => {
  it("loads bounded ACT evidence for the selected profile", async () => {
    const evidence = {
      organization: { id: "org-1", name: "Alamosa ARTs Festival (Alamosa) CO", city: "Alamosa", region: "CO", phone: "(719) 937-2636", website: "https://www.societyhall.org/" },
      contacts: [],
      actText: [{ sourceRecordId: "source-1", sourceVersionId: "version-1", sourcePath: "$.Description", kind: "description", originalText: "Society Hall Annual Celebration | Societyhall@gmail.com", emails: ["societyhall@gmail.com"] }],
      emailCandidates: [{ email: "societyhall@gmail.com", sourceRecordId: "source-1", sourceVersionId: "version-1", sourcePath: "$.Description" }],
    };
    const api = { get: vi.fn().mockResolvedValue({ evidence }), post: vi.fn() };

    await expect(createLeadIntakeClient(api).getProfileEvidence("org-1")).resolves.toEqual(evidence);
    expect(api.get).toHaveBeenCalledWith("/lead-intake/organizations/org-1/evidence");
  });
});
