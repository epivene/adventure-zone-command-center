import { describe, expect, it, vi } from "vitest";

import { GoogleValidationLearningRepository } from "./google-validation-learning-repository";

function fakePool() {
  const query = vi.fn(async (text: string) => {
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id", account_email: "TheAdventureZone12@gmail.com" }] };
    }
    if (text.includes("FROM google_workspace_validation_mappings")) {
      return {
        rows: [
          {
            thread_id: "thread-manual",
            organization_id: "org-a",
            organization_name: "Lake County Fair",
            evidence_codes: ["manual_profile_assignment"],
            validation_status: "ready_for_review",
          },
          {
            thread_id: "thread-approved",
            organization_id: "org-b",
            organization_name: "Logan Pride Festival",
            evidence_codes: ["exact_profile_name_subject"],
            validation_status: "approved",
          },
          {
            thread_id: "thread-ambiguous",
            organization_id: "org-a",
            organization_name: "Lake County Fair",
            evidence_codes: ["exact_profile_name_subject"],
            validation_status: "approved",
          },
          {
            thread_id: "thread-ambiguous",
            organization_id: "org-b",
            organization_name: "Logan Pride Festival",
            evidence_codes: ["exact_profile_name_subject"],
            validation_status: "approved",
          },
          {
            thread_id: "thread-manual-wins",
            organization_id: "org-a",
            organization_name: "Lake County Fair",
            evidence_codes: ["manual_profile_assignment"],
            validation_status: "approved",
          },
          {
            thread_id: "thread-manual-wins",
            organization_id: "org-b",
            organization_name: "Logan Pride Festival",
            evidence_codes: ["ai_profile_match"],
            validation_status: "approved",
          },
        ],
      };
    }
    if (text.includes("FROM google_workspace_validation_review_items")) {
      return {
        rows: [
          {
            from_header: "Fair Office <fairgrounds@co.lake.or.us>",
            to_header: "Adventure Zone <theadventurezone12@gmail.com>",
            resolved_organization_id: "org-a",
            organization_name: "Lake County Fair",
          },
          {
            from_header: "Adventure Zone <theadventurezone12@gmail.com>",
            to_header: "Christina <christina@saltaevents.com>",
            resolved_organization_id: "org-b",
            organization_name: "Logan Pride Festival",
          },
          {
            from_header: "shared@example.org",
            to_header: "theadventurezone12@gmail.com",
            resolved_organization_id: "org-a",
            organization_name: "Lake County Fair",
          },
          {
            from_header: "shared@example.org",
            to_header: "theadventurezone12@gmail.com",
            resolved_organization_id: "org-b",
            organization_name: "Logan Pride Festival",
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { query };
}

describe("GoogleValidationLearningRepository", () => {
  it("learns confirmed thread targets and only unique external email targets", async () => {
    const repository = new GoogleValidationLearningRepository(fakePool());

    const learned = await repository.load();

    expect(learned.mailboxEmails).toEqual(new Set(["theadventurezone12@gmail.com"]));
    expect(learned.threadTargets.get("thread-manual")).toEqual({
      id: "org-a",
      name: "Lake County Fair",
    });
    expect(learned.threadTargets.get("thread-approved")).toEqual({
      id: "org-b",
      name: "Logan Pride Festival",
    });
    expect(learned.threadTargets.has("thread-ambiguous")).toBe(false);
    expect(learned.threadTargets.get("thread-manual-wins")).toEqual({
      id: "org-a",
      name: "Lake County Fair",
    });

    expect(learned.addressTargets.get("fairgrounds@co.lake.or.us")).toEqual({
      id: "org-a",
      name: "Lake County Fair",
    });
    expect(learned.addressTargets.get("christina@saltaevents.com")).toEqual({
      id: "org-b",
      name: "Logan Pride Festival",
    });
    expect(learned.addressTargets.has("shared@example.org")).toBe(false);
    expect(learned.addressTargets.has("theadventurezone12@gmail.com")).toBe(false);
  });
});
