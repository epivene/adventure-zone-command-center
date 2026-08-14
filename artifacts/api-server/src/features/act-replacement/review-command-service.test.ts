import { describe, expect, it } from "vitest";
import { ActApplyService } from "./apply-service";
import { InMemoryApplyRepository } from "./apply-repository";
import { InMemoryApprovalRepository } from "./approval-service";
import {
  automaticReviewRequestFingerprint,
  InMemoryReviewCommandStore,
  ReviewCommandService,
  type AutomaticReviewCommandResult,
  type AutomaticReviewDecisionInput,
  type SaveDecisionInput,
} from "./review-command-service";
import { buildActOrganizeManifest, type ActOrganizeManifest, type ManifestSourceInput } from "./manifest-builder";
import { fingerprintSourceContent } from "./source-fingerprint";
const manifest: ActOrganizeManifest = { digest: "d", diagnostics: [], outcomes: [{ sourceRecordId: "a", sourceVersionId: "v", state: "awaiting_review", issues: [{ code: "field_conflict", reason: "phone" }], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [] }], operations: [{ operationKey: "organization:a", sourceRecordId: "a", sourceVersionId: "v", targetType: "organization", action: "create", payload: { normalized: { kind: "organization", name: "A" } }, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true }] };
function service() { const approvals = new InMemoryApprovalRepository(); approvals.seed("r", { ...manifest, outcomes: [{ sourceRecordId: "a", sourceVersionId: "v", state: "ready", issues: [], candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: ["organization:a"] }] }); const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true }); applyRepo.seedManifest("r", "d"); applyRepo.seedOperations(manifest.operations); const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo as never, false)); store.seed("r", manifest, { a: "v" }); return new ReviewCommandService(store); }

const reviewOutcome = (
  sourceRecordId: string,
  sourceVersionId: string,
  code: string,
  reason: string,
): ActOrganizeManifest["outcomes"][number] => ({
  sourceRecordId,
  sourceVersionId,
  state: code === "unsupported_record" ? "unsupported" : "awaiting_review",
  issues: [{ code, reason }],
  candidates: [],
  match: null,
  mappingWarnings: [],
  unsupportedFieldPaths: [],
  operationKeys: [],
});

const automaticOutcome = (
  sourceRecordId: string,
  sourceVersionId: string,
  issues: ActOrganizeManifest["outcomes"][number]["issues"],
  match: ActOrganizeManifest["outcomes"][number]["match"] = null,
): ActOrganizeManifest["outcomes"][number] => ({
  sourceRecordId,
  sourceVersionId,
  state: "awaiting_review",
  issues,
  candidates: [],
  match,
  mappingWarnings: [],
  unsupportedFieldPaths: [],
  operationKeys: [],
});

class AutomaticReviewTestStore extends InMemoryReviewCommandStore {
  beforeNextValidation?: () => void;

  protected override validatedDecision(runId: string, input: SaveDecisionInput): SaveDecisionInput {
    const beforeValidation = this.beforeNextValidation;
    this.beforeNextValidation = undefined;
    beforeValidation?.();
    return super.validatedDecision(runId, input);
  }
}

function automaticService() {
  const outcomes: ActOrganizeManifest["outcomes"] = [
    automaticOutcome("linked", "v-linked", [{ code: "ambiguous_match", reason: "multiple_candidates" }]),
    automaticOutcome("separate", "v-separate", [{ code: "ambiguous_match", reason: "multiple_candidates" }]),
    automaticOutcome("assigned", "v-assigned", [
      { code: "relationship_unresolved", reason: "missing_parent", relationshipSlot: "company-parent", expectedParentTypes: ["organization"], canImportStandalone: false },
      { code: "relationship_unresolved", reason: "missing_secondary_parent", relationshipSlot: "secondary-parent", expectedParentTypes: ["organization"], canImportStandalone: false },
    ]),
    automaticOutcome("unlinked", "v-unlinked", [{ code: "relationship_unresolved", reason: "missing_parent", relationshipSlot: "optional-parent", expectedParentTypes: ["organization"], canImportStandalone: true }]),
    automaticOutcome("fields", "v-fields", [
      { code: "field_conflict", reason: "email" },
      { code: "field_conflict", reason: "phone" },
    ], {
      kind: "exact",
      localId: "local-fields",
      reason: "exact_external_link",
    }),
    automaticOutcome("unsupported", "v-unsupported", [{ code: "unsupported_record", reason: "normalization_failed" }]),
  ];
  const currentManifest: ActOrganizeManifest = {
    digest: "automatic-digest-1",
    diagnostics: [],
    outcomes,
    operations: [{
      operationKey: "contact:fields",
      sourceRecordId: "fields",
      sourceVersionId: "v-fields",
      targetType: "contact",
      action: "link_existing",
      payload: { localId: "local-fields", normalized: { name: "Fields Person", email: "act@example.com", phone: "555-ACT" } },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: false,
    }],
  };
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new AutomaticReviewTestStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("automatic-run", currentManifest, {
    linked: { sourceVersionId: "v-linked", streamType: "contact" },
    separate: { sourceVersionId: "v-separate", streamType: "contact" },
    assigned: { sourceVersionId: "v-assigned", streamType: "activity" },
    unlinked: { sourceVersionId: "v-unlinked", streamType: "activity" },
    fields: { sourceVersionId: "v-fields", streamType: "contact", localFields: { email: "local@example.com", phone: "555-LOCAL" } },
    unsupported: { sourceVersionId: "v-unsupported", streamType: "unsupported" },
  });
  for (const [type, id] of [
    ["contact", "local-linked"],
    ["contact", "local-fields"],
    ["organization", "local-parent"],
    ["organization", "secondary-parent"],
  ] as const) store.seedTarget(type, id);
  store.seedAutomaticReview("automatic-run", {
    records: [
      { sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", unsupportedRecord: true },
      { sourceRecordId: "fields", sourceVersionId: "v-fields", conflicts: [{ fieldName: "phone" }, { fieldName: "email" }], match: { kind: "exact", localId: "local-fields", reason: "exact_external_link" } },
      { sourceRecordId: "unlinked", sourceVersionId: "v-unlinked", relationshipIssues: [outcomes[3]!.issues[0] as never] },
      { sourceRecordId: "assigned", sourceVersionId: "v-assigned", relationshipIssues: outcomes[2]!.issues as never },
      { sourceRecordId: "separate", sourceVersionId: "v-separate", targetEntityType: "contact", issues: [{ code: "ambiguous_match" }], match: { kind: "ambiguous", candidateIds: ["candidate-1", "candidate-2"], reason: "multiple_candidates" } },
      { sourceRecordId: "linked", sourceVersionId: "v-linked", issues: [{ code: "ambiguous_match" }], match: { kind: "ambiguous", candidateIds: ["local-linked"], reason: "multiple_candidates" } },
    ],
    context: {
      sourceRecords: [
        { sourceRecordId: "linked", sourceVersionId: "v-linked", streamType: "contact", display: { fullName: "Linked Person" } },
        { sourceRecordId: "separate", sourceVersionId: "v-separate", streamType: "contact", display: { fullName: "Separate Person" } },
        { sourceRecordId: "assigned", sourceVersionId: "v-assigned", streamType: "activity", display: { subject: "Call" }, relationshipLabelsBySlot: { "company-parent": { organization: "Parent Org" }, "secondary-parent": { organization: "Secondary Parent" } } },
        { sourceRecordId: "unlinked", sourceVersionId: "v-unlinked", streamType: "activity", display: { subject: "Email" } },
        { sourceRecordId: "fields", sourceVersionId: "v-fields", streamType: "contact", display: { fullName: "Fields Person" } },
      ],
      targetsByEntityType: {
        contact: [
          { id: "local-linked", entityType: "contact", label: "Linked Person", detail: null, fields: {} },
          { id: "local-fields", entityType: "contact", label: "Fields Person", detail: null, fields: {} },
        ],
        organization: [
          { id: "local-parent", entityType: "organization", label: "Parent Org", detail: null, fields: {} },
          { id: "secondary-parent", entityType: "organization", label: "Secondary Parent", detail: null, fields: {} },
        ],
      },
    },
  });
  let rebuilds = 0;
  store.rebuildAfterReviewChange = async () => {
    rebuilds += 1;
    store.manifests.set("automatic-run", { ...currentManifest, digest: "automatic-digest-2" });
    return { status: "ready_to_apply" };
  };
  return { commands: new ReviewCommandService(store), store, rebuilds: () => rebuilds };
}

const automaticEnvelope = { runId: "automatic-run", expectedManifestDigest: "automatic-digest-1", requestKey: "automatic-request", requestedBy: "owner" };
function automaticComplete(result: AutomaticReviewCommandResult) {
  expect(result.status).toBe("complete");
  if (result.status !== "complete") throw new Error("automatic_review_not_complete");
  return result;
}

describe("automatic heterogeneous review decisions", () => {
  it("persists a proof-bound mixed batch in deterministic decision order and rebuilds once", async () => {
    const { commands, rebuilds } = automaticService();
    const result = automaticComplete(await commands.resolveAutomatically(automaticEnvelope));
    expect(result.decisions.map(({ sourceRecordId, scope, decision, fieldName, relationshipSlot }) => ({ sourceRecordId, scope, decision, fieldName, relationshipSlot }))).toEqual([
      { sourceRecordId: "assigned", scope: "relationship", decision: "assign_parent", fieldName: null, relationshipSlot: "company-parent" },
      { sourceRecordId: "assigned", scope: "relationship", decision: "assign_parent", fieldName: null, relationshipSlot: "secondary-parent" },
      { sourceRecordId: "fields", scope: "field_conflict", decision: "use_source", fieldName: "email", relationshipSlot: null },
      { sourceRecordId: "fields", scope: "field_conflict", decision: "use_source", fieldName: "phone", relationshipSlot: null },
      { sourceRecordId: "linked", scope: "duplicate_identity", decision: "link_existing", fieldName: null, relationshipSlot: null },
      { sourceRecordId: "separate", scope: "duplicate_identity", decision: "keep_separate", fieldName: null, relationshipSlot: null },
      { sourceRecordId: "unlinked", scope: "relationship", decision: "keep_unlinked", fieldName: null, relationshipSlot: "optional-parent" },
      { sourceRecordId: "unsupported", scope: "unsupported_record", decision: "ignore_source", fieldName: null, relationshipSlot: null },
    ]);
    expect(result.decisions.filter((decision) => decision.decision === "use_source")).toEqual([
      expect.objectContaining({ fieldName: "email", reviewedSourceValue: "act@example.com", reviewedLocalValue: "local@example.com" }),
      expect.objectContaining({ fieldName: "phone", reviewedSourceValue: "555-ACT", reviewedLocalValue: "555-LOCAL" }),
    ]);
    expect(result.summary).toMatchObject({ linkedExisting: 1, importedNew: 1, relationshipsAssigned: 2, relationshipsOmitted: 1, actValuesSelected: 2, unsupportedIgnored: 1, manualReview: 0, decisionsCreatedOrReplayed: 8 });
    expect(rebuilds()).toBe(1);
  });

  it("fingerprints reordered heterogeneous decisions identically and binds the full envelope", () => {
    const decisions: AutomaticReviewDecisionInput[] = [
      { sourceRecordId: "b", sourceVersionId: "v-b", scope: "field_conflict", decision: "use_source", fieldName: "phone", relationshipSlot: null, targetEntityType: "contact", targetEntityId: "local-b" },
      { sourceRecordId: "a", sourceVersionId: "v-a", scope: "relationship", decision: "assign_parent", fieldName: null, relationshipSlot: "parent", targetEntityType: "organization", targetEntityId: "local-a" },
    ];
    const input = { runId: "run", expectedManifestDigest: "digest", actor: "owner", policyVersion: "policy-1", decisions };
    expect(automaticReviewRequestFingerprint(input)).toBe(automaticReviewRequestFingerprint({ ...input, decisions: [...decisions].reverse() }));
    expect(automaticReviewRequestFingerprint(input)).not.toBe(automaticReviewRequestFingerprint({ ...input, actor: "other" }));
    expect(automaticReviewRequestFingerprint(input)).not.toBe(automaticReviewRequestFingerprint({ ...input, expectedManifestDigest: "other" }));
    expect(automaticReviewRequestFingerprint(input)).not.toBe(automaticReviewRequestFingerprint({ ...input, policyVersion: "policy-2" }));
  });

  it("fingerprints reversed null, empty, and Unicode-distinct selections identically", () => {
    const decisions: AutomaticReviewDecisionInput[] = [
      { sourceRecordId: "same", sourceVersionId: "v", scope: "relationship", decision: "keep_unlinked", fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null },
      { sourceRecordId: "same", sourceVersionId: "v", scope: "relationship", decision: "keep_unlinked", fieldName: "", relationshipSlot: "", targetEntityType: "", targetEntityId: "" },
      { sourceRecordId: "unicode", sourceVersionId: "v", scope: "field_conflict", decision: "use_source", fieldName: "e\u0301", relationshipSlot: null, targetEntityType: "contact", targetEntityId: "local" },
      { sourceRecordId: "unicode", sourceVersionId: "v", scope: "field_conflict", decision: "use_source", fieldName: "é", relationshipSlot: null, targetEntityType: "contact", targetEntityId: "local" },
    ];
    const input = { runId: "run", expectedManifestDigest: "digest", actor: "owner", policyVersion: "policy", decisions };

    expect(automaticReviewRequestFingerprint(input)).toBe(automaticReviewRequestFingerprint({ ...input, decisions: [...decisions].reverse() }));
  });

  it("returns an exact replay without rebuilding or replacing the audit actor", async () => {
    const { commands, rebuilds } = automaticService();
    const first = automaticComplete(await commands.resolveAutomatically(automaticEnvelope));
    const replay = automaticComplete(await commands.resolveAutomatically(automaticEnvelope));
    expect(replay).toEqual(first);
    expect(replay.decisions.every((decision) => decision.decidedBy === "owner")).toBe(true);
    expect(rebuilds()).toBe(1);
  });

  it("keeps colon-containing run and request tuple identities distinct", async () => {
    const approvals = new InMemoryApprovalRepository();
    const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
    const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
    const emptyManifest = (digest: string): ActOrganizeManifest => ({ digest, diagnostics: [], outcomes: [], operations: [] });
    store.seed("a:b", emptyManifest("digest-ab"), {}, "owner");
    store.seedAutomaticReview("a:b", { records: [] });
    store.seed("a", emptyManifest("digest-a"), {}, "owner");
    store.seedAutomaticReview("a", { records: [] });
    const commands = new ReviewCommandService(store);
    await expect(commands.resolveAutomatically({ runId: "a:b", expectedManifestDigest: "digest-ab", requestKey: "c", requestedBy: "owner" })).resolves.toMatchObject({ manifestDigest: "digest-ab", decisions: [] });
    await expect(commands.resolveAutomatically({ runId: "a", expectedManifestDigest: "digest-a", requestKey: "b:c", requestedBy: "owner" })).resolves.toMatchObject({ manifestDigest: "digest-a", decisions: [] });
  });

  it("rejects a same-tuple replay when the recomputed request fingerprint changes", async () => {
    const { commands, store, rebuilds } = automaticService();
    const first = automaticComplete(await commands.resolveAutomatically(automaticEnvelope));
    store.seedAutomaticReview("automatic-run", { records: [] });
    await expect(commands.resolveAutomatically(automaticEnvelope)).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
    expect(first.decisions).toHaveLength(8);
    expect(rebuilds()).toBe(1);
  });

  it("rejects stale manifest and source state before writing any automatic decision", async () => {
    const staleManifest = automaticService();
    await expect(staleManifest.commands.resolveAutomatically({ ...automaticEnvelope, expectedManifestDigest: "stale" })).rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
    expect(staleManifest.rebuilds()).toBe(0);
    const staleSource = automaticService();
    staleSource.store.seedAutomaticReview("automatic-run", {
      records: [{ sourceRecordId: "linked", sourceVersionId: "stale", issues: [{ code: "ambiguous_match" }], match: { kind: "ambiguous", candidateIds: ["local-linked"], reason: "multiple_candidates" } }],
      context: { sourceRecords: [{ sourceRecordId: "linked", sourceVersionId: "stale", streamType: "contact", display: { fullName: "Linked Person" } }], targetsByEntityType: { contact: [{ id: "local-linked", entityType: "contact", label: "Linked Person", detail: null, fields: {} }] } },
    });
    await expect(staleSource.commands.resolveAutomatically(automaticEnvelope)).rejects.toMatchObject({ code: "stale_source_version", status: 409 });
    expect(await staleSource.commands.decisions("linked")).toEqual([]);
    expect(staleSource.rebuilds()).toBe(0);
  });

  it("leaves duplicate exact targets for manual review and writes no unsafe identity decision", async () => {
    const { commands, store, rebuilds } = automaticService();
    store.seedAutomaticReview("automatic-run", {
      records: [{ sourceRecordId: "linked", sourceVersionId: "v-linked", issues: [{ code: "ambiguous_match" }], match: { kind: "ambiguous", candidateIds: ["local-linked"], reason: "multiple_candidates" } }],
      context: { sourceRecords: [{ sourceRecordId: "linked", sourceVersionId: "v-linked", streamType: "contact", display: { fullName: "Linked Person" } }], targetsByEntityType: { contact: [{ id: "local-linked", entityType: "contact", label: "Linked Person", detail: null, fields: {} }, { id: "duplicate-linked", entityType: "contact", label: "Linked Person", detail: null, fields: {} }] } },
    });
    const result = automaticComplete(await commands.resolveAutomatically(automaticEnvelope));
    expect(result.decisions).toEqual([]);
    expect(result.summary.manualReview).toBe(1);
    expect(rebuilds()).toBe(0);
  });

  it("rejects a local field change between proof capture and decision validation", async () => {
    const { commands, store, rebuilds } = automaticService();
    store.beforeNextValidation = () => {
      store.seed("automatic-run", store.manifests.get("automatic-run")!, { fields: { sourceVersionId: "v-fields", streamType: "contact", localFields: { email: "concurrent@example.com", phone: "555-LOCAL" } } });
    };
    await expect(commands.resolveAutomatically(automaticEnvelope)).rejects.toMatchObject({ code: "stale_review_token", status: 409 });
    expect(await commands.decisions("fields")).toEqual([]);
    expect(rebuilds()).toBe(0);
  });

  it("reruns automatic cleanup to replace only a field decision made stale by a local edit", async () => {
    const { commands, store } = automaticService();
    const first = automaticComplete(await commands.resolveAutomatically(automaticEnvelope));
    const oldPhone = first.decisions.find((decision) => decision.sourceRecordId === "fields" && decision.fieldName === "phone")!;
    const current = store.manifests.get("automatic-run")!;
    store.seed("automatic-run", {
      ...current,
      digest: "automatic-digest-2",
      outcomes: [automaticOutcome("fields", "v-fields", [{ code: "field_conflict", reason: "phone" }], {
        kind: "exact", localId: "local-fields", reason: "exact_external_link",
      })],
      operations: current.operations,
    }, {
      fields: { sourceVersionId: "v-fields", streamType: "contact", localFields: { email: "local@example.com", phone: "555-CONCURRENT" } },
    });
    store.seedAutomaticReview("automatic-run", {
      records: [{
        sourceRecordId: "fields", sourceVersionId: "v-fields",
        conflicts: [{ fieldName: "phone" }],
        match: { kind: "exact", localId: "local-fields", reason: "exact_external_link" },
      }],
      context: {
        sourceRecords: [{ sourceRecordId: "fields", sourceVersionId: "v-fields", streamType: "contact", display: { fullName: "Fields Person" } }],
        targetsByEntityType: { contact: [{ id: "local-fields", entityType: "contact", label: "Fields Person", detail: null, fields: {} }] },
      },
    });

    const rerun = automaticComplete(await commands.resolveAutomatically({
      ...automaticEnvelope,
      expectedManifestDigest: "automatic-digest-2",
      requestKey: "automatic-rerun",
    }));

    expect(rerun.decisions).toEqual([
      expect.objectContaining({ fieldName: "phone", decision: "use_source", reviewedLocalValue: "555-CONCURRENT", active: true }),
    ]);
    expect(store.decisions.get("fields")).toEqual([
      expect.objectContaining({ fieldName: "email", active: true }),
      expect.objectContaining({ id: oldPhone.id, fieldName: "phone", active: false, reviewedLocalValue: "555-LOCAL" }),
      expect.objectContaining({ id: rerun.decisions[0]!.id, fieldName: "phone", active: true, reviewedLocalValue: "555-CONCURRENT" }),
    ]);
  });

  it("accepts an empty no-op run without rebuilding and validates the service envelope", async () => {
    const { commands, store, rebuilds } = automaticService();
    store.seedAutomaticReview("automatic-run", { records: [] });
    await expect(commands.resolveAutomatically(automaticEnvelope)).resolves.toMatchObject({ decisions: [], manifestDigest: "automatic-digest-1", summary: { decisionsCreatedOrReplayed: 0, manualReview: 0 } });
    expect(rebuilds()).toBe(0);
    for (const input of [
      { ...automaticEnvelope, runId: " " },
      { ...automaticEnvelope, expectedManifestDigest: " " },
      { ...automaticEnvelope, requestKey: " " },
      { ...automaticEnvelope, requestedBy: " " },
    ]) await expect(commands.resolveAutomatically(input)).rejects.toMatchObject({ code: "invalid_automatic_review", status: 400 });
  });
});

function bulkService(input: {
  outcomes?: ActOrganizeManifest["outcomes"];
  sourceDetails?: Record<string, { sourceVersionId: string; streamType: string; localFields?: Record<string, unknown> }>;
  currentOperations?: ActOrganizeManifest["operations"];
  rebuiltManifest?: ActOrganizeManifest;
} = {}) {
  const outcomes = input.outcomes ?? [
    reviewOutcome("a", "v-a", "unsupported_record", "normalization_failed"),
    reviewOutcome("b", "v-b", "unsupported_record", "normalization_failed"),
  ];
  const currentManifest: ActOrganizeManifest = {
    digest: "digest-1", diagnostics: [], outcomes, operations: input.currentOperations ?? [],
  };
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", currentManifest, input.sourceDetails ?? {
    a: { sourceVersionId: "v-a", streamType: "company" },
    b: { sourceVersionId: "v-b", streamType: "company" },
  });
  let rebuilds = 0;
  store.rebuildAfterReviewChange = async () => {
    rebuilds += 1;
    store.manifests.set("run", input.rebuiltManifest ?? { ...currentManifest, digest: "digest-2" });
    return { status: "ready_to_apply" };
  };
  return { commands: new ReviewCommandService(store), store, rebuilds: () => rebuilds };
}

const unsupportedBulkInput = {
  runId: "run",
  expectedManifestDigest: "digest-1",
  scope: "unsupported_record" as const,
  decision: "ignore_source" as const,
  fieldName: null,
  requestedBy: "owner",
  requestKey: "bulk-1",
  selections: [
    { sourceRecordId: "a", sourceVersionId: "v-a" },
    { sourceRecordId: "b", sourceVersionId: "v-b" },
  ],
};

function fieldBulkService() {
  const outcomes = [
    reviewOutcome("a", "v-a", "field_conflict", "phone"),
    reviewOutcome("b", "v-b", "field_conflict", "phone"),
  ];
  outcomes[0]!.match = { kind: "exact", localId: "local-a" };
  outcomes[1]!.match = { kind: "exact", localId: "local-b" };
  const currentOperations = ["a", "b"].map((sourceRecordId) => ({
    operationKey: `organization:${sourceRecordId}`,
    sourceRecordId,
    sourceVersionId: `v-${sourceRecordId}`,
    targetType: "organization" as const,
    action: "link_existing" as const,
    payload: { localId: `local-${sourceRecordId}`, normalized: { phone: "555-ACT" } },
    dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: false,
  }));
  return bulkService({
    outcomes,
    currentOperations,
    sourceDetails: {
      a: { sourceVersionId: "v-a", streamType: "company", localFields: { phone: "555-LOCAL-A" } },
      b: { sourceVersionId: "v-b", streamType: "company", localFields: { phone: "555-LOCAL-B" } },
    },
  });
}

const conflictToken = (sourceRecordId: "a" | "b", localValue = `555-LOCAL-${sourceRecordId.toUpperCase()}`) => ({
  sourceRecordId,
  sourceVersionId: `v-${sourceRecordId}`,
  fieldName: "phone",
  sourceValueFingerprint: fingerprintSourceContent({ value: "555-ACT" }),
  targetEntityType: "organization",
  targetEntityId: `local-${sourceRecordId}`,
  localValueFingerprint: fingerprintSourceContent({ value: localValue }),
});

const fieldBulkInput = {
  ...unsupportedBulkInput,
  scope: "field_conflict" as const,
  decision: "use_source" as const,
  fieldName: "phone",
  selections: [
    { sourceRecordId: "a", sourceVersionId: "v-a", reviewToken: conflictToken("a") },
    { sourceRecordId: "b", sourceVersionId: "v-b", reviewToken: conflictToken("b") },
  ],
};
describe("Act review command service", () => {
  it("returns the durable organizer manifest ready for apply", async () => {
    const s = service();
    await expect(s.organize("r")).resolves.toEqual({ status: "ready_to_apply", manifest });
  });
  it("supports many assignments and stale protection", async () => { const s = service(); await expect(s.assign({ runId: "r", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o1", sourceVersionId: "v", expectedSourceVersionId: "v", assignedBy: "owner", requestKey: "1" })).resolves.toMatchObject({ targetEntityId: "o1" }); await expect(s.assign({ runId: "r", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o2", sourceVersionId: "v", expectedSourceVersionId: "old", assignedBy: "owner", requestKey: "2" })).rejects.toMatchObject({ code: "stale_source_version", status: 409 }); });
  it("rejects assignment decisions and requires an actor for safe field decisions", async () => { const s = service(); await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "d1", decidedBy: " " })).rejects.toMatchObject({ code: "invalid_decision" }); await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "d2", decidedBy: "owner" })).resolves.toMatchObject({ decision: "keep_local", decidedBy: "owner" }); await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "duplicate_identity", decision: "assign_parent", requestKey: "d3", decidedBy: "owner" })).rejects.toMatchObject({ code: "invalid_decision" }); });
  it("rejects incompatible review decision scope and value pairs", async () => {
    const s = service();

    await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "ignore_source", fieldName: "phone", requestKey: "wrong-field", decidedBy: "owner" })).rejects.toMatchObject({ code: "invalid_decision" });
    await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "unsupported_record", decision: "keep_local", requestKey: "wrong-unsupported", decidedBy: "owner" })).rejects.toMatchObject({ code: "invalid_decision" });
    await expect(s.decide({ runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "relationship", decision: "keep_unlinked", requestKey: "relationship", decidedBy: "owner" })).rejects.toMatchObject({ code: "relationship_issue_not_found" });
  });
  it("supersedes only a proof-stale field decision when saving its fresh replacement", async () => {
    const { commands, store } = fieldBulkService();
    const first = await commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "automatic-field", decidedBy: "owner",
      reviewToken: conflictToken("a"),
    });
    store.seed("run", store.manifests.get("run")!, {
      a: { sourceVersionId: "v-a", streamType: "company", localFields: { phone: "555-CONCURRENT" } },
    });

    const replacement = await commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "manual-replacement", decidedBy: "owner",
      reviewToken: conflictToken("a", "555-CONCURRENT"),
    });

    expect(replacement).toMatchObject({ decision: "use_source", reviewedLocalValue: "555-CONCURRENT", active: true });
    expect(await commands.decisions("a")).toEqual([expect.objectContaining({ id: replacement.id, active: true })]);
    expect(store.decisions.get("a")).toEqual([
      expect.objectContaining({ id: first.id, active: false, reviewedLocalValue: "555-LOCAL-A" }),
      expect.objectContaining({ id: replacement.id, active: true, reviewedLocalValue: "555-CONCURRENT" }),
    ]);
  });
  it("does not supersede a still-valid or conflicting active field decision", async () => {
    const valid = fieldBulkService();
    await valid.commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "valid-first", decidedBy: "owner",
      reviewToken: conflictToken("a"),
    });
    await expect(valid.commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "valid-second", decidedBy: "owner",
      reviewToken: conflictToken("a"),
    })).rejects.toMatchObject({ code: "decision_already_active", status: 409 });
    expect(valid.store.decisions.get("a")).toHaveLength(1);
    expect(valid.store.decisions.get("a")?.[0]).toMatchObject({ active: true, reviewedLocalValue: "555-LOCAL-A" });

    const conflicting = fieldBulkService();
    await conflicting.commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "keep_local", fieldName: "phone", requestKey: "keep-local-first", decidedBy: "owner",
    });
    await expect(conflicting.commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "use-source-second", decidedBy: "owner",
      reviewToken: conflictToken("a"),
    })).rejects.toMatchObject({ code: "decision_already_active", status: 409 });
    expect(conflicting.store.decisions.get("a")).toEqual([
      expect.objectContaining({ decision: "keep_local", active: true }),
    ]);
  });
  it("rejects a changed individual decision under the same request key", async () => {
    const s = service();
    await s.decide({
      runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict",
      decision: "keep_local", fieldName: "phone", requestKey: "decision-replay", decidedBy: "owner",
    });

    await expect(s.decide({
      runId: "r", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict",
      decision: "keep_local", fieldName: "email", requestKey: "decision-replay", decidedBy: "owner",
    })).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
  });
  it("delegates current issue and source validation to the atomic decision store", async () => {
    const approvals = new InMemoryApprovalRepository();
    const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
    const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
    store.seed("run", {
      digest: "digest-before",
      diagnostics: [],
      operations: [],
      outcomes: [reviewOutcome("a", "v-a", "field_conflict", "phone")],
    }, { a: { sourceVersionId: "v-a", streamType: "company" } });
    store.getSource = async () => {
      throw new Error("source validation escaped the atomic store");
    };
    store.rebuildAfterReviewChange = async () => ({ status: "ready_to_apply" });

    await expect(new ReviewCommandService(store).decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "keep_local", fieldName: "phone", requestKey: "atomic-decision", decidedBy: "owner",
    })).resolves.toMatchObject({ decision: "keep_local", fieldName: "phone" });
  });
  it("rejects individual decisions that are not bound to the current issue and target shape", async () => {
    const commandFor = (outcome: ActOrganizeManifest["outcomes"][number]) => {
      const approvals = new InMemoryApprovalRepository();
      const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
      const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
      store.seed("run", { digest: "digest", diagnostics: [], operations: [], outcomes: [outcome] }, {
        [outcome.sourceRecordId]: { sourceVersionId: outcome.sourceVersionId, streamType: "company" },
      });
      store.rebuildAfterReviewChange = async () => ({ status: "ready_to_apply" });
      return new ReviewCommandService(store);
    };
    const ready = { ...reviewOutcome("a", "v-a", "field_conflict", "phone"), state: "ready" as const, issues: [] };
    const ambiguous = { ...reviewOutcome("a", "v-a", "ambiguous_match", "multiple_candidates"), match: { kind: "ambiguous", candidateIds: ["local-a"] } };

    await expect(commandFor(ready).decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "keep_local", fieldName: "phone", requestKey: "missing-conflict", decidedBy: "owner",
    })).rejects.toMatchObject({ code: "decision_not_applicable", status: 409 });
    await expect(commandFor(ready).decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "unsupported_record",
      decision: "ignore_source", requestKey: "missing-unsupported", decidedBy: "owner",
    })).rejects.toMatchObject({ code: "decision_not_applicable", status: 409 });
    await expect(commandFor(ambiguous).decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "duplicate_identity",
      decision: "keep_separate", targetEntityType: "organization", targetEntityId: "local-a",
      requestKey: "keep-with-target", decidedBy: "owner",
    })).rejects.toMatchObject({ code: "decision_target_not_allowed", status: 409 });
    await expect(commandFor(ambiguous).decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "duplicate_identity",
      decision: "link_existing", targetEntityType: "organization", targetEntityId: "missing-target",
      requestKey: "missing-target", decidedBy: "owner",
    })).rejects.toMatchObject({ code: "review_target_not_found", status: 409 });
  });
  it("returns dependency closure and refuses apply when disabled", async () => { const s = service(); await expect(s.approve({ runId: "r", operationIds: ["organization:a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" })).resolves.toMatchObject({ approvedOperationIds: ["organization:a"] }); await expect(s.apply({ runId: "r", approvedOperationIds: ["organization:a"], expectedManifestDigest: "d", requestKey: "k", requestedBy: "owner" })).rejects.toMatchObject({ code: "act_apply_disabled" }); });
  it("fails closed when legacy ready approval has no automatic proof", async () => {
    const s = service();

    await expect(s.approveReady({ runId: "r", expectedManifestDigest: "d", requestKey: "ready", requestedBy: "owner" })).resolves.toMatchObject({ approvedOperationIds: [] });
  });
});

const timelineSource = (reviewIssues: ManifestSourceInput["reviewIssues"] = []): ManifestSourceInput => ({
  sourceRecordId: "timeline-source",
  sourceVersionId: "timeline-version",
  streamType: "activity",
  normalized: {
    kind: "timeline",
    category: "calendar",
    sourceType: "activity",
    body: "Call Ada",
    subject: "Call Ada",
    sourceOccurredAt: null,
    timelineSortAt: "2026-08-09T00:00:00.000Z",
    dateIsImportFallback: true,
    endsAt: null,
    status: null,
  },
  match: { kind: "none", reason: "no_candidate" },
  warnings: [],
  unsupportedFieldPaths: [],
  reviewIssues,
});

function relationshipDecisionService(source: ManifestSourceInput) {
  const initial = buildActOrganizeManifest({ runId: "run", sources: [source] });
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seedTarget("organization", "local-organization-id");
  store.seed("run", initial, {
    [source.sourceRecordId]: { sourceVersionId: source.sourceVersionId, streamType: source.streamType },
  });
  store.rebuildAfterReviewChange = async () => {
    const decisions = (store.decisions.get(source.sourceRecordId) ?? []).map((decision) => ({
      ...decision,
      decisionId: decision.id,
      createdAt: "2026-08-09T00:00:00.000Z",
    }));
    const rebuilt = buildActOrganizeManifest({
      runId: "run",
      sources: [{ ...source, reviewDecisions: decisions as never }],
    });
    store.manifests.set("run", rebuilt);
    approvals.seed("run", rebuilt);
    return { status: "ready_to_apply" };
  };
  return { commands: new ReviewCommandService(store), store };
}

describe("relationship review decisions", () => {
  it("rebuilds an assigned local parent into a relationship operation without relabeling the child identity", async () => {
    const { commands, store } = relationshipDecisionService(timelineSource());

    const decision = await commands.decide({
      runId: "run",
      sourceRecordId: "timeline-source",
      sourceVersionId: "timeline-version",
      scope: "relationship",
      decision: "assign_parent",
      relationshipSlot: "timeline-parent",
      targetEntityType: "organization",
      targetEntityId: "local-organization-id",
      requestKey: "assign-parent",
      decidedBy: "owner",
    });

    expect(decision).toMatchObject({
      scope: "relationship",
      decision: "assign_parent",
      relationshipSlot: "timeline-parent",
      targetEntityType: "organization",
      targetEntityId: "local-organization-id",
    });
    expect(await commands.assignments("timeline-source")).toEqual([]);

    const rebuilt = await store.getManifest("run");
    expect(rebuilt?.outcomes).toContainEqual(expect.objectContaining({
      sourceRecordId: "timeline-source",
      state: "ready",
      issues: [],
    }));
    expect(rebuilt?.operations).toContainEqual(expect.objectContaining({
      sourceRecordId: "timeline-source",
      targetType: "activity_association",
      action: "create_relationship",
      payload: expect.objectContaining({
        parentEntityId: "local-organization-id",
        parentType: "organization",
        relationshipSlot: "timeline-parent",
      }),
    }));
    expect(rebuilt?.operations).not.toContainEqual(expect.objectContaining({
      sourceRecordId: "timeline-source",
      action: "link_existing",
      payload: expect.objectContaining({ localId: "local-organization-id" }),
    }));

    const approval = await commands.approveReady({
      runId: "run",
      expectedManifestDigest: rebuilt!.digest,
      requestKey: "approve-assigned-parent",
      requestedBy: "owner",
    });
    expect(approval.approvedOperationIds).toContain("activity:timeline-source");
    expect(approval.approvedOperationIds).toEqual(expect.arrayContaining([
      expect.stringMatching(/^activity_association:timeline-source:/),
    ]));
  });

  it("rebuilds a supported broken relationship as a standalone import and approves no relationship operation", async () => {
    const source = timelineSource([{
      code: "relationship_unresolved",
      reason: "unresolved_exact_relationship",
      relationshipSlot: "missing-organization",
      expectedParentTypes: ["organization"],
      canImportStandalone: true,
    } as never]);
    const { commands, store } = relationshipDecisionService(source);

    await commands.decide({
      runId: "run",
      sourceRecordId: "timeline-source",
      sourceVersionId: "timeline-version",
      scope: "relationship",
      decision: "keep_unlinked",
      relationshipSlot: "missing-organization",
      targetEntityType: "organization",
      requestKey: "import-standalone",
      decidedBy: "owner",
    });

    const rebuilt = await store.getManifest("run");
    expect(rebuilt?.outcomes).toContainEqual(expect.objectContaining({
      sourceRecordId: "timeline-source",
      state: "ready",
      issues: [],
    }));
    expect(rebuilt?.operations).toContainEqual(expect.objectContaining({
      operationKey: "activity:timeline-source",
      action: "create",
    }));
    expect(rebuilt?.operations).not.toContainEqual(expect.objectContaining({
      sourceRecordId: "timeline-source",
      action: "create_relationship",
    }));

    const approval = await commands.approveReady({
      runId: "run",
      expectedManifestDigest: rebuilt!.digest,
      requestKey: "approve-standalone",
      requestedBy: "owner",
    });
    expect(approval.approvedOperationIds).toContain("activity:timeline-source");
    expect(approval.approvedOperationIds).not.toEqual(expect.arrayContaining([
      expect.stringMatching(/^activity_association:/),
    ]));
  });

  it("returns an exact durable retry before the rebuilt relationship issue is revalidated", async () => {
    const source = timelineSource([{
      code: "relationship_unresolved",
      reason: "unresolved_exact_relationship",
      relationshipSlot: "missing-organization",
      expectedParentTypes: ["organization"],
      canImportStandalone: true,
    }]);
    const { commands, store } = relationshipDecisionService(source);
    const rebuild = store.rebuildAfterReviewChange.bind(store);
    let rebuilds = 0;
    store.rebuildAfterReviewChange = async (runId) => {
      rebuilds += 1;
      return rebuild(runId);
    };
    const input = {
      runId: "run", sourceRecordId: "timeline-source", sourceVersionId: "timeline-version",
      scope: "relationship", decision: "keep_unlinked", relationshipSlot: "missing-organization",
      targetEntityType: "organization", requestKey: "relationship-replay", decidedBy: "owner",
    } as const;

    const first = await commands.decide(input);
    await expect(commands.decide(input)).resolves.toEqual(first);
    expect(rebuilds).toBe(1);

    await expect(commands.decide({ ...input, decision: "ignore_source" }))
      .rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
    expect(rebuilds).toBe(1);
  });
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
  await expect(commands.decide({ runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "decision", decidedBy: "owner" })).rejects.toMatchObject({ code: "manifest_rebuild_failed" });

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

it("returns pre-existing idempotent evidence without attempting another rebuild", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", manifest, { a: "v" });
  const commands = new ReviewCommandService(store);
  const assignmentInput = { runId: "run", sourceRecordId: "a", targetEntityType: "organization", targetEntityId: "o1", sourceVersionId: "v", expectedSourceVersionId: "v", assignedBy: "owner", requestKey: "assignment" };
  const decisionInput = { runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict", decision: "keep_local", fieldName: "phone", requestKey: "decision", decidedBy: "owner" };
  const assignment = await commands.assign(assignmentInput);
  const decision = await commands.decide(decisionInput);
  store.rebuildAfterReviewChange = async () => { throw Object.assign(new Error("rebuild failed"), { code: "manifest_rebuild_failed" }); };

  await expect(commands.assign(assignmentInput)).resolves.toEqual(assignment);
  await expect(commands.decide(decisionInput)).resolves.toEqual(decision);
  await expect(commands.removeDecision({ runId: "run", sourceRecordId: "a", decisionId: decision.id, actor: "owner", requestKey: "remove-decision" })).rejects.toMatchObject({ code: "manifest_rebuild_failed" });
  expect(await commands.assignments("a")).toEqual([assignment]);
  expect(await commands.decisions("a")).toEqual([expect.objectContaining({ id: decision.id, active: true })]);
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
    decision: "keep_local", fieldName: "phone", requestKey: "post-complete-add", decidedBy: "owner",
  });
  phase = "complete";
  await commands.removeDecision({
    runId: "run", sourceRecordId: "a", decisionId: decision.id,
    actor: "user_owner_123", requestKey: "post-complete-remove",
  });

  expect(rebuilds).toBe(2);
  expect(await commands.decisions("a")).toEqual([]);
});

it("makes decision supersession retries request-key idempotent without another rebuild", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", {
    ...manifest,
    outcomes: [reviewOutcome("a", "v", "field_conflict", "phone")],
  }, { a: "v" });
  let rebuilds = 0;
  store.rebuildAfterReviewChange = async () => {
    rebuilds += 1;
    return { status: "ready_to_apply" };
  };
  const commands = new ReviewCommandService(store);
  const decision = await commands.decide({
    runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict",
    decision: "keep_local", fieldName: "phone", requestKey: "create", decidedBy: "owner",
  });
  const removal = {
    runId: "run", sourceRecordId: "a", decisionId: decision.id,
    actor: "owner", requestKey: "remove-once",
  };

  const first = await commands.removeDecision(removal);
  await expect(commands.removeDecision(removal)).resolves.toEqual(first);
  expect(rebuilds).toBe(2);
});

it("rejects reusing a decision supersession request key for a different decision", async () => {
  const approvals = new InMemoryApprovalRepository();
  const applyRepo = new InMemoryApplyRepository({ unsafeForTests: true });
  const store = new InMemoryReviewCommandStore(approvals, new ActApplyService(applyRepo, false));
  store.seed("run", {
    ...manifest,
    outcomes: [{
      ...reviewOutcome("a", "v", "field_conflict", "phone"),
      issues: [
        { code: "field_conflict", reason: "phone" },
        { code: "field_conflict", reason: "email" },
      ],
    }],
  }, { a: "v" });
  store.rebuildAfterReviewChange = async () => ({ status: "ready_to_apply" });
  const commands = new ReviewCommandService(store);
  const phone = await commands.decide({
    runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict",
    decision: "keep_local", fieldName: "phone", requestKey: "create-phone", decidedBy: "owner",
  });
  const email = await commands.decide({
    runId: "run", sourceRecordId: "a", sourceVersionId: "v", scope: "field_conflict",
    decision: "keep_local", fieldName: "email", requestKey: "create-email", decidedBy: "owner",
  });

  await commands.removeDecision({ runId: "run", sourceRecordId: "a", decisionId: phone.id, actor: "owner", requestKey: "remove-key" });
  await expect(commands.removeDecision({ runId: "run", sourceRecordId: "a", decisionId: email.id, actor: "owner", requestKey: "remove-key" }))
    .rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
});

describe("atomic bulk review decisions", () => {
  it("bulk accepts homogeneous two-clue identity recommendations and derives their targets", async () => {
    const recommended = (sourceRecordId: "a" | "b") => ({
      ...reviewOutcome(sourceRecordId, `v-${sourceRecordId}`, "field_conflict", "phone"),
      match: {
        kind: "exact",
        localId: `local-${sourceRecordId}`,
        reason: "two_independent_context_clues",
        evidence: [
          { family: "identity", label: "name", targetEntityType: "organization", targetEntityId: `local-${sourceRecordId}`, authority: "supporting" },
          { family: "web_identity", label: "website", targetEntityType: "organization", targetEntityId: `local-${sourceRecordId}`, authority: "supporting" },
        ],
      },
    });
    const create = () => {
      const service = bulkService({ outcomes: [recommended("a"), recommended("b")] });
      service.store.seedTarget("organization", "local-a");
      service.store.seedTarget("organization", "local-b");
      return service;
    };
    const input = {
      ...unsupportedBulkInput,
      scope: "duplicate_identity" as const,
      decision: "link_existing" as const,
      fieldName: null,
      requestKey: "bulk-context-link",
    };

    const linked = create();
    await expect(linked.commands.bulkDecide(input)).resolves.toMatchObject({
      decisions: expect.arrayContaining([
        expect.objectContaining({ sourceRecordId: "a", scope: "duplicate_identity", decision: "link_existing", targetEntityType: "organization", targetEntityId: "local-a" }),
        expect.objectContaining({ sourceRecordId: "b", scope: "duplicate_identity", decision: "link_existing", targetEntityType: "organization", targetEntityId: "local-b" }),
      ]),
    });
    expect(linked.rebuilds()).toBe(1);

    const separated = create();
    await expect(separated.commands.bulkDecide({ ...input, decision: "keep_separate", requestKey: "bulk-context-separate" })).resolves.toMatchObject({
      decisions: expect.arrayContaining([
        expect.objectContaining({ decision: "keep_separate", targetEntityType: null, targetEntityId: null }),
      ]),
    });
  });

  it("rejects identity bulk decisions with conflicting targets, mixed confidence, or no evidence", async () => {
    const evidence = (targetEntityId: string, authority: "supporting" | "authoritative" = "supporting") => ({
      family: "identity",
      label: "name",
      targetEntityType: "organization" as const,
      targetEntityId,
      authority,
    });
    const recommended = (sourceRecordId: "a" | "b", matchEvidence: ReturnType<typeof evidence>[]) => ({
      ...reviewOutcome(sourceRecordId, `v-${sourceRecordId}`, "field_conflict", "phone"),
      match: { kind: "exact" as const, localId: `local-${sourceRecordId}`, evidence: matchEvidence },
    });
    const input = {
      ...unsupportedBulkInput,
      scope: "duplicate_identity" as const,
      decision: "link_existing" as const,
      fieldName: null,
      requestKey: "bulk-invalid-context",
    };
    const cases = [
      [
        recommended("a", [evidence("local-a"), { ...evidence("other-a"), family: "web_identity" }]),
        recommended("b", [evidence("local-b"), { ...evidence("local-b"), family: "web_identity" }]),
      ],
      [
        recommended("a", [evidence("local-a", "authoritative")]),
        recommended("b", [evidence("local-b"), { ...evidence("local-b"), family: "web_identity" }]),
      ],
      [recommended("a", []), recommended("b", [])],
    ];

    for (const outcomes of cases) {
      const { commands, rebuilds } = bulkService({ outcomes });
      await expect(commands.bulkDecide(input)).rejects.toMatchObject({ status: 409 });
      expect(rebuilds()).toBe(0);
    }
  });

  it("requires immutable conflict tokens for individual and bulk use-source decisions", async () => {
    const { commands } = fieldBulkService();

    await expect(commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "individual-no-token", decidedBy: "owner",
    })).rejects.toMatchObject({ code: "review_token_required", status: 409 });
    await expect(commands.bulkDecide({
      ...fieldBulkInput,
      requestKey: "bulk-no-token",
      selections: fieldBulkInput.selections.map(({ reviewToken: _reviewToken, ...selection }) => selection),
    })).rejects.toMatchObject({ code: "review_token_required", status: 409 });
  });

  it("derives and persists individual overwrite proof from the reviewed conflict token", async () => {
    const { commands } = fieldBulkService();

    const decision = await commands.decide({
      runId: "run", sourceRecordId: "a", sourceVersionId: "v-a", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", requestKey: "individual-token", decidedBy: "owner",
      targetEntityType: "contact", targetEntityId: "attacker-selected-target", reviewToken: conflictToken("a"),
    });

    expect(decision).toMatchObject({
      targetEntityType: "organization",
      targetEntityId: "local-a",
      reviewedSourceValue: "555-ACT",
      reviewedSourceValueFingerprint: conflictToken("a").sourceValueFingerprint,
      reviewedLocalValue: "555-LOCAL-A",
      reviewedLocalValueFingerprint: conflictToken("a").localValueFingerprint,
    });
  });

  it("atomically rejects a conflict token after the reviewed local value changes", async () => {
    const { commands, rebuilds } = fieldBulkService();

    await expect(commands.bulkDecide({
      ...fieldBulkInput,
      selections: [
        fieldBulkInput.selections[0],
        { ...fieldBulkInput.selections[1], reviewToken: conflictToken("b", "555-OLD-B") },
      ],
    })).rejects.toMatchObject({ code: "stale_review_token", status: 409 });
    expect(rebuilds()).toBe(0);
    expect(await commands.decisions("a")).toEqual([]);
    expect(await commands.decisions("b")).toEqual([]);
  });

  it("saves homogeneous decisions with the authenticated actor and rebuilds exactly once", async () => {
    const { commands, rebuilds } = bulkService();

    const result = await commands.bulkDecide(unsupportedBulkInput);

    expect(result).toMatchObject({ manifestDigest: "digest-2", reviewedOperationIds: [] });
    expect(result.decisions).toHaveLength(2);
    expect(result.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRecordId: "a", decidedBy: "owner", requestKey: "bulk-1" }),
      expect.objectContaining({ sourceRecordId: "b", decidedBy: "owner", requestKey: "bulk-1" }),
    ]));
    expect(rebuilds()).toBe(1);
  });

  it("delegates selected source validation to the atomic bulk store operation", async () => {
    const { commands, store } = bulkService();
    let individualSourceReads = 0;
    const originalGetSource = store.getSource.bind(store);
    store.getSource = async (sourceRecordId) => {
      individualSourceReads += 1;
      return originalGetSource(sourceRecordId);
    };

    await commands.bulkDecide(unsupportedBulkInput);

    expect(individualSourceReads).toBe(0);
  });

  it("returns only rebuilt reviewed overwrites matching the selected source and field", async () => {
    const outcomes = [
      reviewOutcome("a", "v-a", "field_conflict", "phone"),
      reviewOutcome("b", "v-b", "field_conflict", "phone"),
    ];
    const operation = (operationKey: string, sourceRecordId: string, fieldName: string) => ({
      operationKey, sourceRecordId, sourceVersionId: `v-${sourceRecordId}`,
      targetType: "organization" as const, action: "overwrite_reviewed" as const,
      payload: { fieldName }, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: false,
    });
    const rebuiltManifest: ActOrganizeManifest = {
      digest: "digest-2", diagnostics: [], outcomes,
      operations: [
        operation("organization:a:field:phone", "a", "phone"),
        operation("organization:b:field:phone", "b", "phone"),
        operation("organization:a:field:email", "a", "email"),
        operation("organization:c:field:phone", "c", "phone"),
      ],
    };
    const rootOperation = (sourceRecordId: string) => ({
      operationKey: `organization:${sourceRecordId}`, sourceRecordId, sourceVersionId: `v-${sourceRecordId}`,
      targetType: "organization" as const, action: "link_existing" as const,
      payload: { localId: `local-${sourceRecordId}`, normalized: { phone: "555-ACT" } },
      dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: false,
    });
    const currentOperations = [rootOperation("a"), rootOperation("b")];
    outcomes[0]!.match = { kind: "exact", localId: "local-a" };
    outcomes[1]!.match = { kind: "exact", localId: "local-b" };
    const { commands } = bulkService({
      outcomes,
      currentOperations,
      rebuiltManifest,
      sourceDetails: {
        a: { sourceVersionId: "v-a", streamType: "company", localFields: { phone: "555-LOCAL-A" } },
        b: { sourceVersionId: "v-b", streamType: "company", localFields: { phone: "555-LOCAL-B" } },
      },
    });

    const result = await commands.bulkDecide(fieldBulkInput);

    expect(result.reviewedOperationIds).toEqual([
      "organization:a:field:phone", "organization:b:field:phone",
    ]);
    expect(result.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ targetEntityType: "organization", targetEntityId: "local-a", reviewedSourceValue: "555-ACT", reviewedLocalValue: "555-LOCAL-A" }),
      expect.objectContaining({ targetEntityType: "organization", targetEntityId: "local-b", reviewedSourceValue: "555-ACT", reviewedLocalValue: "555-LOCAL-B" }),
    ]));
  });

  it("rejects invalid bounds, duplicate records, invalid decisions, and invalid field shapes before rebuilding", async () => {
    const invalidInputs = [
      { ...unsupportedBulkInput, selections: [] },
      { ...unsupportedBulkInput, selections: Array.from({ length: 201 }, (_, index) => ({ sourceRecordId: `source-${index}`, sourceVersionId: `version-${index}` })) },
      { ...unsupportedBulkInput, selections: [unsupportedBulkInput.selections[0], unsupportedBulkInput.selections[0]] },
      { ...unsupportedBulkInput, scope: "duplicate_identity", decision: "keep_local" },
      { ...unsupportedBulkInput, scope: "field_conflict", decision: "keep_local", fieldName: null },
      { ...unsupportedBulkInput, fieldName: "phone" },
      { ...unsupportedBulkInput, requestedBy: " " },
      { ...unsupportedBulkInput, requestKey: " " },
    ];
    const { commands, rebuilds } = bulkService();

    for (const input of invalidInputs) {
      await expect(commands.bulkDecide(input as never)).rejects.toMatchObject({ status: 400 });
    }
    expect(rebuilds()).toBe(0);
    expect(await commands.decisions("a")).toEqual([]);
    expect(await commands.decisions("b")).toEqual([]);
  });

  it("rejects stale digests and every stale source version before persistence", async () => {
    const { commands, rebuilds } = bulkService();

    await expect(commands.bulkDecide({ ...unsupportedBulkInput, expectedManifestDigest: "stale" }))
      .rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
    await expect(commands.bulkDecide({
      ...unsupportedBulkInput,
      selections: [unsupportedBulkInput.selections[0], { sourceRecordId: "b", sourceVersionId: "stale" }],
    })).rejects.toMatchObject({ code: "stale_source_version", status: 409 });

    expect(rebuilds()).toBe(0);
    expect(await commands.decisions("a")).toEqual([]);
    expect(await commands.decisions("b")).toEqual([]);
  });

  it("rejects non-applicable and heterogeneous outcomes, including ambiguous identity bulk resolution", async () => {
    const cases: Array<{ outcomes: ActOrganizeManifest["outcomes"]; sourceDetails?: Record<string, { sourceVersionId: string; streamType: string }>; input: Record<string, unknown> }> = [
      {
        outcomes: [reviewOutcome("a", "v-a", "field_conflict", "phone"), reviewOutcome("b", "v-b", "field_conflict", "email")],
        input: { ...unsupportedBulkInput, scope: "field_conflict", decision: "keep_local", fieldName: "phone" },
      },
      {
        outcomes: [reviewOutcome("a", "v-a", "unsupported_record", "normalization_failed"), reviewOutcome("b", "v-b", "unsupported_record", "unknown_normalized_kind")],
        input: unsupportedBulkInput,
      },
      {
        outcomes: [reviewOutcome("a", "v-a", "unsupported_record", "normalization_failed"), reviewOutcome("b", "v-b", "unsupported_record", "normalization_failed")],
        sourceDetails: { a: { sourceVersionId: "v-a", streamType: "company" }, b: { sourceVersionId: "v-b", streamType: "contact" } },
        input: unsupportedBulkInput,
      },
      {
        outcomes: [reviewOutcome("a", "v-a", "relationship_unresolved", "missing_parent"), reviewOutcome("b", "v-b", "relationship_unresolved", "different_reason")],
        input: { ...unsupportedBulkInput, scope: "relationship", decision: "ignore_source" },
      },
      {
        outcomes: [reviewOutcome("a", "v-a", "relationship_unresolved", "missing_parent"), reviewOutcome("b", "v-b", "relationship_unresolved", "missing_parent")],
        sourceDetails: { a: { sourceVersionId: "v-a", streamType: "company_contact" }, b: { sourceVersionId: "v-b", streamType: "company_contact" } },
        input: { ...unsupportedBulkInput, scope: "relationship", decision: "keep_unlinked" },
      },
      {
        outcomes: [reviewOutcome("a", "v-a", "ambiguous_match", "multiple_candidates"), reviewOutcome("b", "v-b", "ambiguous_match", "multiple_candidates")],
        input: { ...unsupportedBulkInput, scope: "duplicate_identity", decision: "keep_separate" },
      },
    ];

    for (const entry of cases) {
      const { commands, rebuilds } = bulkService({ outcomes: entry.outcomes, sourceDetails: entry.sourceDetails });
      await expect(commands.bulkDecide(entry.input as never)).rejects.toMatchObject({ status: expect.any(Number) });
      expect(rebuilds()).toBe(0);
      expect(await commands.decisions("a")).toEqual([]);
      expect(await commands.decisions("b")).toEqual([]);
    }
  });

  it("rolls back all decisions and the manifest when persistence or rebuild fails", async () => {
    const persistenceFailure = bulkService();
    await persistenceFailure.store.saveDecision({
      sourceRecordId: "b", sourceVersionId: "v-b", scope: "unsupported_record", decision: "ignore_source",
      requestKey: "existing", fieldName: null, targetEntityType: null, targetEntityId: null, decidedBy: "original-owner",
    });
    await expect(persistenceFailure.commands.bulkDecide(unsupportedBulkInput))
      .rejects.toMatchObject({ code: "decision_already_active", status: 409 });
    expect(await persistenceFailure.commands.decisions("a")).toEqual([]);
    expect(await persistenceFailure.commands.decisions("b")).toEqual([
      expect.objectContaining({ requestKey: "existing", decidedBy: "original-owner" }),
    ]);
    expect((await persistenceFailure.store.getManifest("run"))?.digest).toBe("digest-1");

    const rebuildFailure = bulkService();
    rebuildFailure.store.rebuildAfterReviewChange = async () => {
      rebuildFailure.store.manifests.set("run", { digest: "partial", diagnostics: [], outcomes: [], operations: [] });
      throw Object.assign(new Error("rebuild failed"), { code: "manifest_rebuild_failed" });
    };
    await expect(rebuildFailure.commands.bulkDecide(unsupportedBulkInput))
      .rejects.toMatchObject({ code: "manifest_rebuild_failed" });
    expect(await rebuildFailure.commands.decisions("a")).toEqual([]);
    expect(await rebuildFailure.commands.decisions("b")).toEqual([]);
    expect((await rebuildFailure.store.getManifest("run"))?.digest).toBe("digest-1");
  });

  it("replays an equivalent reordered selection without rebuilding or replacing the audit actor", async () => {
    const { commands, rebuilds } = bulkService();
    const first = await commands.bulkDecide(unsupportedBulkInput);
    const replay = await commands.bulkDecide({
      ...unsupportedBulkInput,
      expectedManifestDigest: "stale-on-exact-replay",
      selections: [...unsupportedBulkInput.selections].reverse(),
    });

    expect(replay).toEqual(first);
    expect(replay.decisions.every((decision) => decision.decidedBy === "owner")).toBe(true);
    expect(rebuilds()).toBe(1);
  });

  it("rejects a changed decision using the same bulk request key without replacing prior evidence", async () => {
    const { commands, rebuilds } = fieldBulkService();
    await commands.bulkDecide(fieldBulkInput);

    await expect(commands.bulkDecide({
      ...fieldBulkInput,
      expectedManifestDigest: "digest-2",
      decision: "keep_local",
    })).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });

    expect(await commands.decisions("a")).toEqual([
      expect.objectContaining({ decision: "use_source", decidedBy: "owner" }),
    ]);
    expect(await commands.decisions("b")).toEqual([
      expect.objectContaining({ decision: "use_source", decidedBy: "owner" }),
    ]);
    expect(rebuilds()).toBe(1);
  });

  it("rejects changed bulk selections and versions before any partial decision write", async () => {
    const selectionCollision = bulkService();
    await selectionCollision.commands.bulkDecide({
      ...unsupportedBulkInput,
      selections: [unsupportedBulkInput.selections[0]!],
    });

    await expect(selectionCollision.commands.bulkDecide({
      ...unsupportedBulkInput,
      expectedManifestDigest: "digest-2",
    })).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
    expect(await selectionCollision.commands.decisions("b")).toEqual([]);
    expect(selectionCollision.rebuilds()).toBe(1);

    const versionCollision = bulkService();
    await versionCollision.commands.bulkDecide({
      ...unsupportedBulkInput,
      selections: [unsupportedBulkInput.selections[0]!],
    });
    await expect(versionCollision.commands.bulkDecide({
      ...unsupportedBulkInput,
      expectedManifestDigest: "digest-2",
      selections: [{ sourceRecordId: "a", sourceVersionId: "changed-version" }],
    })).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
    expect(await versionCollision.commands.decisions("a")).toEqual([
      expect.objectContaining({ sourceVersionId: "v-a" }),
    ]);
    expect(versionCollision.rebuilds()).toBe(1);
  });

  it("rejects the wrong authenticated run owner before any decision write", async () => {
    const { commands, rebuilds } = bulkService();

    await expect(commands.bulkDecide({ ...unsupportedBulkInput, requestedBy: "intruder" }))
      .rejects.toMatchObject({ code: "run_not_found", status: 404 });

    expect(await commands.decisions("a")).toEqual([]);
    expect(await commands.decisions("b")).toEqual([]);
    expect(rebuilds()).toBe(0);
  });
});
