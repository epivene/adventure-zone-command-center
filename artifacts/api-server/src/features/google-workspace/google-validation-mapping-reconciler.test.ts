import { describe, expect, it, vi } from "vitest";

import { GoogleValidationMappingReconciler } from "./google-validation-mapping-reconciler";

function fakePool() {
  const queries: Array<{ text: string; values?: unknown[] }> = [];
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    queries.push({ text, values });
    if (text.includes("FROM google_workspace_connections")) {
      return { rows: [{ id: "connection-id" }] };
    }
    if (text.includes("review_state = 'resolved'")) {
      return { rows: [{ message_id: "manual-message" }] };
    }
    return { rows: [] };
  });
  return { query, queries };
}

describe("GoogleValidationMappingReconciler", () => {
  it("replaces stale automatic mappings for the current sample without overwriting manual assignments", async () => {
    const pool = fakePool();
    const reconciler = new GoogleValidationMappingReconciler(pool);

    await reconciler.reconcile({
      messageIds: ["m1", "manual-message"],
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
      ],
    });

    const deleteQuery = pool.queries.find(({ text }) =>
      text.includes("DELETE FROM google_workspace_validation_mappings"),
    );
    expect(deleteQuery?.values).toEqual([
      "connection-id",
      ["m1", "manual-message"],
      ["manual-message"],
    ]);

    const inserts = pool.queries.filter(({ text }) =>
      text.includes("INSERT INTO google_workspace_validation_mappings"),
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.values).toEqual([
      "connection-id",
      "m1",
      "t1",
      "logan-pride",
      null,
      JSON.stringify(["exact_profile_name_subject"]),
    ]);
  });
});
