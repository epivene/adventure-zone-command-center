import { describe, expect, it } from "vitest";
import { ActApplyService } from "./apply-service";
import { InMemoryApplyRepository } from "./apply-repository";
import { InMemoryApprovalRepository } from "./approval-service";
import { InMemoryReviewCommandStore, ReviewCommandService } from "./review-command-service";
import type { ActOrganizeManifest } from "./manifest-builder";
const manifest: ActOrganizeManifest = { digest: "d", diagnostics: [], outcomes: [], operations: [{ operationKey: "organization:a", sourceRecordId: "a", sourceVersionId: "v", targetType: "organization", action: "create", payload: { normalized: { kind: "organization", name: "A" } }, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true }] };
function service() { const approvals = new InMemoryApprovalRepository(); approvals.seed("r", manifest); const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true }); applyRepo.seedManifest("r", "d"); applyRepo.seedOperations(manifest.operations); const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo as never, false)); store.seed("r", manifest, { a: "v" }); return new ReviewCommandService(store); }
describe("Act review command service", () => {
  it("returns the durable organizer manifest ready for apply", async () => {
    const s = service();
    await expect(s.organize("r")).resolves.toEqual({ status: "ready_to_apply", manifest });
  });
  it("supports many assignments and stale protection", async () => { const s = service(); await expect(s.assign({ runId: "r", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o1", sourceVersionId: "v", expectedSourceVersionId: "v", assignedBy: "owner", requestKey: "1" })).resolves.toMatchObject({ targetEntityId: "o1" }); await expect(s.assign({ runId: "r", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o2", sourceVersionId: "v", expectedSourceVersionId: "old", assignedBy: "owner", requestKey: "2" })).rejects.toMatchObject({ code: "stale_source_version", status: 409 }); });
  it("rejects assignment decisions and supports safe field decisions", async () => { const s = service(); await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "d1" })).resolves.toMatchObject({ decision: "keep_local" }); await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "duplicate_identity", decision: "assign_parent", requestKey: "d2" })).rejects.toMatchObject({ code: "invalid_decision" }); });
  it("returns dependency closure and refuses apply when disabled", async () => { const s = service(); await expect(s.approve({ runId: "r", operationIds: ["organization:a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" })).resolves.toMatchObject({ approvedOperationIds: ["organization:a"] }); await expect(s.apply({ runId: "r", approvedOperationIds: ["organization:a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" })).rejects.toMatchObject({ code: "act_apply_disabled" }); });
});

it("removes newly saved review evidence when the durable manifest rebuild fails", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", manifest, { a: "v" });
  store.rebuildAfterReviewChange = async () => {
    store.manifests.set("run", { ...manifest, digest: "partially-persisted-digest" });
    throw Object.assign(new Error("rebuild failed"), { code: "manifest_rebuild_failed" });
  };
  const commands = new ReviewCommandService(store);

  await expect(commands.assign({ runId: "run", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o1", sourceVersionId: "v", expectedSourceVersionId: "v", assignedBy: "owner", requestKey: "assignment" })).rejects.toMatchObject({ code: "manifest_rebuild_failed" });
  await expect(commands.decide({ runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "decision" })).rejects.toMatchObject({ code: "manifest_rebuild_failed" });

  expect(await commands.assignments("a")).toEqual([]);
  expect(await commands.decisions("a")).toEqual([]);
  expect(await store.getManifest("run")).toEqual(manifest);
});

it("rebuilds after removals and keeps the evidence active if that rebuild fails", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", manifest, { a: "v" });
  const commands = new ReviewCommandService(store);
  const assignment = await commands.assign({ runId: "run", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o1", sourceVersionId: "v", expectedSourceVersionId: "v", assignedBy: "owner", requestKey: "assignment" });
  store.rebuildAfterReviewChange = async () => { throw Object.assign(new Error("rebuild failed"), { code: "manifest_rebuild_failed" }); };

  await expect(commands.removeAssignment({
    runId: "run", sourceRecordId: "a", assignmentId: assignment.id, actor: "owner", expectedSourceVersionId: "v", requestKey: "remove",
  } as never)).rejects.toMatchObject({ code: "manifest_rebuild_failed" });
  expect(await commands.assignments("a")).toEqual([expect.objectContaining({ id: assignment.id, active: true })]);
});

it("never deletes pre-existing idempotent evidence when a replay rebuild fails", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", manifest, { a: "v" });
  const commands = new ReviewCommandService(store);
  const assignmentInput = { runId: "run", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o1", sourceVersionId: "v", expectedSourceVersionId: "v", assignedBy: "owner", requestKey: "assignment" };
  const decisionInput = { runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "decision" };
  const assignment = await commands.assign(assignmentInput);
  const decision = await commands.decide(decisionInput);
  store.rebuildAfterReviewChange = async () => { throw Object.assign(new Error("rebuild failed"), { code: "manifest_rebuild_failed" }); };

  await expect(commands.assign(assignmentInput)).resolves.toEqual(assignment);
  await expect(commands.decide(decisionInput)).rejects.toMatchObject({ code: "manifest_rebuild_failed" });
  await expect(commands.removeDecision({ runId: "run", sourceRecordId: "a", decisionId: decision.id, actor: "owner", requestKey: "remove-decision" })).rejects.toMatchObject({ code: "manifest_rebuild_failed" });
  expect(await commands.assignments("a")).toEqual([assignment]);
  expect(await commands.decisions("a")).toEqual([decision]);
});

it("rebuilds both review additions and removals after a run has completed with review work remaining", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", {
    ...manifest,
    outcomes: [{
      sourceRecordId: "a", sourceVersionId: "v", state: "awaiting_review",
      issues: [{ code: "field_conflict", reason: "phone" }], candidates: [], match: null,
      mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
    }],
  }, { a: "v" });
  let phase = "complete";
  let rebuilds = 0;
  store.rebuildAfterReviewChange = async () => {
    expect(phase).toBe("complete");
    rebuilds += 1;
    phase = "ready_to_apply";
    return { status: phase };
  };
  const commands = new ReviewCommandService(store);

  const decision = await commands.decide({
    runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict",
    decision: "keep_local", fieldName: "phone", requestKey: "post-complete-add",
  });
  phase = "complete";
  await commands.removeDecision({
    runId: "run", sourceRecordId: "a", decisionId: decision.id,
    actor: "user_owner_123", requestKey: "post-complete-remove",
  });

  expect(rebuilds).toBe(2);
  expect(await commands.decisions("a")).toEqual([]);
});
