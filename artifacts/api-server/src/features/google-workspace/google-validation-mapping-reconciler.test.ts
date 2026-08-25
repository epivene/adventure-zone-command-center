import { describe, expect, it, vi } from "vitest";

import { GoogleValidationMappingReconciler } from "./google-validation-mapping-reconciler";

function fakePool() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (text.includes("FROM google_workspace_validation_review_items")) {
      return {
        rows: [
          {
            message_id: "manual-message",
            thread_id: "manual-thread",
            review_state: "resolved",
            resolved_organization_id: "manual-target",
            evidence_codes: ["exact_profile_name_text", "manual_profile_assignment"],
          },
          {
            message_id: "ignored-message",
            thread_id: "ignored-thread",
            review_state: "ignored",
            resolved_organization_id: null,
            evidence_codes: ["manual_ignore"],
          },
        ],
      };
    }
    return { rows: [] };
  });
  return { query, queries };
}

describe("GoogleValidationMappingReconciler", () => {
  it("replaces stale sample mappings, restores manual assignments, and preserves manual ignores", async () => {
    const pool = fakePool();
    const reconciler = new GoogleValidationMappingReconciler(pool);

    await reconciler.reconcile({
      messageIds: ["m1", "manual-message", "ignored-message"],
      rows: [
        {
          messageId: "m1",
          threadId: "t1",
          organizationId: "logan-pride",
          contactId: null,
          evidenceCodes: ["exact_profile_name_subject"],
        },
        {
          messageId: "manual-message",
          threadId: "t2",
          organizationId: "auto-target",
          contactId: null,
          evidenceCodes: ["exact_profile_name_subject"],
        },
        {
          messageId: "ignored-message",
          threadId: "t3",
          organizationId: "bad-auto-target",
          contactId: null,
          evidenceCodes: ["ai_profile_match"],
        },
      ],
    });

    const deleteQuery = pool.queries.find(({ text }) =>
      text.includes("DELETE FROM google_workspace_validation_mappings"),
    );
    expect(deleteQuery?.values).toEqual([
      "connection-id",
      ["m1", "manual-message", "ignored-message"],
    ]);

    const inserts = pool.queries.filter(({ text }) =>
      text.includes("INSERT INTO google_workspace_validation_mappings"),
    );
    expect(inserts).toHaveLength(2);
    expect(inserts[0]?.values).toEqual([
      "connection-id",
      "m1",
      "t1",
      "logan-pride",
      null,
      JSON.stringify(["exact_profile_name_subject"]),
    ]);
    expect(inserts[1]?.values).toEqual([
      "connection-id",
      "manual-message",
      "manual-thread",
      "manual-target",
      null,
      JSON.stringify(["exact_profile_name_text", "manual_profile_assignment"]),
    ]);
    expect(
      inserts.some(({ values }) => values?.[1] === "ignored-message"),
    ).toBe(false);
  });
});
