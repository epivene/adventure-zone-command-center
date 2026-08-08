import { describe, expect, it } from "vitest";
import { InMemoryReviewReader, readReview, safeSource } from "./review-reader";
import type { ActOrganizeManifest } from "./manifest-builder";

const manifest: ActOrganizeManifest = { digest: "digest-1", operations: [], diagnostics: [], outcomes: [
  { sourceRecordId: "a", sourceVersionId: "v1", state: "unassigned", issues: [{ code: "unassigned" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
  { sourceRecordId: "b", sourceVersionId: "v2", state: "ready", issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
  { sourceRecordId: "c", sourceVersionId: "v3", state: "unsupported", issues: [{ code: "unsupported_record" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] },
] };
describe("Act review reader", () => {
  it("paginates/filter rows and returns only safe display data", async () => {
    const reader = new InMemoryReviewReader(); reader.seed("r", manifest, [{ sourceRecordId: "a", sourceVersionId: "v1", streamType: "note", display: { name: "Back call" }, raw: { token: "secret", body: "safe" } }, { sourceRecordId: "b", sourceVersionId: "v2", streamType: "company", display: { name: "Acme" } }]);
    await expect(readReview(reader, { runId: "r", state: "unassigned", pageSize: 25 })).resolves.toMatchObject({ total: 1, manifestDigest: "digest-1", rows: [{ sourceRecordId: "a", display: { name: "Back call" } }] });
    expect(safeSource((await reader.getSource("a"))!, true).raw).toEqual({ body: "safe" });
  });

  it("filters the review queue without mixing in safe records", async () => {
    const reader = new InMemoryReviewReader();
    reader.seed("r", manifest);

    await expect(readReview(reader, { runId: "r", state: "needs_review", pageSize: 25 }))
      .resolves.toMatchObject({
        total: 2,
        rows: [
          { sourceRecordId: "a", state: "unassigned" },
          { sourceRecordId: "c", state: "unsupported" },
        ],
      });
  });
});
