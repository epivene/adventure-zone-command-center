import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  eventChecklistRuns,
  eventChecklistItemResults,
  eventChecklistAttachments,
  resourceConditionIssues,
  eventChecklistOverrides,
} from "@workspace/db";

const migration = readFileSync(
  path.resolve(process.cwd(), "../../lib/db/migrations/20260822_event_checklists.sql"),
  "utf8",
).toLowerCase();

describe("event checklist schema", () => {
  it("exports queryable run, result, attachment, condition, and override tables", () => {
    expect(eventChecklistRuns.clientMutationId).toBeDefined();
    expect(eventChecklistItemResults.followUpSyncState).toBeDefined();
    expect(eventChecklistAttachments.storageKey).toBeDefined();
    expect(resourceConditionIssues.severity).toBeDefined();
    expect(eventChecklistOverrides.action).toBeDefined();
  });

  it("treats a site result with null resource as one identity rather than unlimited null duplicates", () => {
    expect(migration).toContain("coalesce(resource_id, '00000000-0000-0000-0000-000000000000'::uuid)");
    expect(migration).toContain("event_checklist_item_results_identity_unique");
  });
});
