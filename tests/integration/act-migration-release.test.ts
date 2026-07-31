import { describe, expect, it, vi } from "vitest";

import { buildMigrationApplyManifest } from "@/features/act-migration/apply-manifest";
import { ActMigrationApplyService } from "@/features/act-migration/apply-service";
import type {
  ActMigrationApplyRepository,
  MigrationApplyBatch,
  MigrationApplyCounts,
  MigrationApplyOperation,
  MigrationApplyWorkspace,
} from "@/features/act-migration/apply-repository";
import type {
  MigrationApplyManifest,
  MigrationApplyProposal,
} from "@/features/act-migration/apply-types";
import type { LocalMigrationCandidateSnapshot } from "@/features/act-migration/migration-types";
import { ActMigrationPreviewService } from "@/features/act-migration/preview-service";
import { proposalSnapshotDigest } from "@/features/act-migration/reconciliation";
import { sourceSnapshotDigest } from "@/features/act-migration/snapshot-repository";
import { parseSourceItem, type StagedSourceItem } from "@/features/act-migration/source-parser";

const runId = "11111111-1111-4111-8111-111111111111";
const batchId = "22222222-2222-4222-8222-222222222222";

function record(
  streamType: StagedSourceItem["streamType"],
  rawSnapshot: Record<string, unknown>,
): StagedSourceItem {
  const parsed = parseSourceItem(streamType, rawSnapshot);
  if (!parsed.ok) throw new Error("Expected a valid release fixture record.");
  const normalizedSnapshot = parsed.normalized as Record<string, unknown>;
  return {
    streamType,
    sourceKey: parsed.sourceKey,
    sourceId: parsed.sourceId,
    targetSourceId:
      typeof normalizedSnapshot.targetSourceId === "string"
        ? normalizedSnapshot.targetSourceId
        : null,
    rawSnapshot: parsed.rawSnapshot,
    normalizedSnapshot,
    fingerprint: parsed.fingerprint,
    errorCode: null,
    errorFields: [],
  };
}

function emptyCandidates(): LocalMigrationCandidateSnapshot {
  return {
    places: [{
      id: "near-match-local-place",
      name: "Adventure Fair",
      normalizedName: "adventure fair",
      placeType: "other",
      actIndustry: null,
      phone: null,
      normalizedPhone: null,
      address1: "1 Existing Way",
      address2: null,
      city: "Boulder",
      region: "CO",
      normalizedCity: "boulder",
      normalizedRegion: "co",
      postalCode: null,
      website: null,
      normalizedWebsiteHost: null,
    }],
    people: [],
    bookings: [],
    placePeople: [],
    bookingPeople: [],
    externalLinks: [],
  };
}

function operationCounts(
  operations: Iterable<MigrationApplyOperation>,
): MigrationApplyCounts {
  const counts: MigrationApplyCounts = {
    pending: 0,
    leased: 0,
    blocked: 0,
    applied: 0,
    ignored: 0,
    failed: 0,
    total: 0,
  };
  for (const operation of operations) {
    counts[operation.status] += 1;
    counts.total += 1;
  }
  return counts;
}

function batchStatus(counts: MigrationApplyCounts): MigrationApplyBatch["status"] {
  if (counts.failed > 0) return counts.applied > 0 ? "partially_applied" : "failed";
  if (counts.pending > 0 || counts.leased > 0 || counts.blocked > 0) {
    return counts.applied > 0 ? "partially_applied" : "applying";
  }
  return "applied";
}

class PersistentApplyRepository implements ActMigrationApplyRepository {
  private batch: MigrationApplyBatch | null = null;
  private readonly operations = new Map<string, MigrationApplyOperation>();

  constructor(private readonly proposals: readonly MigrationApplyProposal[]) {}

  async createBatchIfAbsent(input: {
    requestKey: string;
    runId: string;
    requestedBy: string;
    manifest?: MigrationApplyManifest;
    now: Date;
  }) {
    if (this.batch) return { ...this.batch, created: false };
    if (!input.manifest) throw new Error("Release fixture requires a reviewed apply manifest.");
    for (const entry of input.manifest.entries) {
      const proposal = this.proposals.find(({ proposalKey }) => proposalKey === entry.proposalKey);
      if (!proposal) throw new Error(`Release fixture proposal is missing: ${entry.proposalKey}`);
      this.operations.set(entry.proposalKey, {
        id: `operation:${entry.proposalKey}`,
        batchId,
        runId: input.runId,
        proposalKey: entry.proposalKey,
        targetEntityType: entry.targetEntityType,
        dependencyProposalKeys: entry.dependencyProposalKeys,
        resolvedDependencies: entry.resolvedDependencies,
        status: "pending",
        attemptCount: 0,
        leaseOwner: null,
        leaseExpiresAt: null,
        appliedEntityId: null,
        errorCode: null,
        retryable: true,
        proposal,
      });
    }
    const counts = operationCounts(this.operations.values());
    this.batch = {
      id: batchId,
      requestKey: input.requestKey,
      runId: input.runId,
      requestedBy: input.requestedBy,
      status: batchStatus(counts),
      manifestDigest: input.manifest.digest,
      summary: counts,
      lastErrorCode: null,
      startedAt: input.now,
      completedAt: null,
    };
    return { ...this.batch, created: true };
  }

  async claimNextOperation(batch: string, leaseOwner: string, now: Date) {
    if (batch !== batchId || !this.batch) return null;
    const candidate = [...this.operations.values()]
      .filter((operation) => operation.status === "pending")
      .find((operation) => operation.dependencyProposalKeys.every((key) =>
        operation.resolvedDependencies.some(({ proposalKey }) => proposalKey === key) ||
        this.operations.get(key)?.status === "applied",
      ));
    if (!candidate) return null;
    candidate.status = "leased";
    candidate.attemptCount += 1;
    candidate.leaseOwner = leaseOwner;
    candidate.leaseExpiresAt = now;
    this.refresh();
    return { ...candidate };
  }

  async completeOperation(input: {
    operationId: string;
    leaseOwner: string;
    entityId: string;
    now: Date;
  }) {
    const operation = [...this.operations.values()].find(({ id }) => id === input.operationId);
    if (!operation || operation.status !== "leased" || operation.leaseOwner !== input.leaseOwner) {
      throw new Error("Release fixture operation lease no longer matches.");
    }
    operation.status = "applied";
    operation.appliedEntityId = input.entityId;
    operation.leaseOwner = null;
    operation.leaseExpiresAt = null;
    this.refresh();
  }

  async failOperation(input: {
    operationId: string;
    leaseOwner: string;
    errorCode: string;
    retryable: boolean;
    now: Date;
  }) {
    const operation = [...this.operations.values()].find(({ id }) => id === input.operationId);
    if (!operation || operation.status !== "leased" || operation.leaseOwner !== input.leaseOwner) {
      throw new Error("Release fixture operation lease no longer matches.");
    }
    operation.status = input.retryable ? "pending" : "failed";
    operation.errorCode = input.errorCode;
    operation.retryable = input.retryable;
    operation.leaseOwner = null;
    operation.leaseExpiresAt = null;
    this.refresh();
  }

  async releaseExpiredLeases() {
    return 0;
  }

  async getApplyWorkspace(requestedRunId: string): Promise<MigrationApplyWorkspace> {
    if (requestedRunId !== runId || !this.batch) throw new Error("Release fixture batch is missing.");
    this.refresh();
    return {
      runId,
      runStatus: this.batch.status,
      counts: this.batch.summary,
      batches: [{ ...this.batch, summary: { ...this.batch.summary } }],
    };
  }

  storedOperations() {
    return [...this.operations.values()].map((operation) => ({ ...operation }));
  }

  private refresh() {
    if (!this.batch) return;
    const summary = operationCounts(this.operations.values());
    this.batch = {
      ...this.batch,
      status: batchStatus(summary),
      summary,
      completedAt: summary.pending || summary.leased || summary.blocked ? null : new Date(),
    };
  }
}

class ReadOnlyActMutator {
  readonly write = vi.fn();
}

type FixtureCommandCenter = {
  places: Map<string, Set<string>>;
  contacts: Set<string>;
  placeContacts: Map<string, Set<string>>;
};

function commandCenterTargets(input: {
  commandCenter: FixtureCommandCenter;
  canonicalPlaceKey: string;
  act: ReadOnlyActMutator;
}) {
  const assertNoActWrites = () => expect(input.act.write).not.toHaveBeenCalled();
  return {
    organization: { apply: async (operation: MigrationApplyOperation) => {
      assertNoActWrites();
      const sources = input.commandCenter.places.get(operation.proposalKey) ?? new Set<string>();
      for (const sourceId of operation.proposal.duplicateSourceIds ?? []) sources.add(sourceId);
      input.commandCenter.places.set(operation.proposalKey, sources);
      return { entityId: operation.proposalKey, changed: sources.size > 0 };
    } },
    contact: { apply: async (operation: MigrationApplyOperation) => {
      assertNoActWrites();
      const changed = !input.commandCenter.contacts.has(operation.proposalKey);
      input.commandCenter.contacts.add(operation.proposalKey);
      return { entityId: operation.proposalKey, changed };
    } },
    organization_contact: { apply: async (operation: MigrationApplyOperation) => {
      assertNoActWrites();
      const contactDependency = operation.dependencyProposalKeys.find((key) => key.startsWith("contact:"));
      if (!contactDependency) throw new Error("Release fixture relationship contact dependency is missing.");
      const relationships = input.commandCenter.placeContacts.get(input.canonicalPlaceKey) ?? new Set<string>();
      const changed = !relationships.has(contactDependency);
      relationships.add(contactDependency);
      input.commandCenter.placeContacts.set(input.canonicalPlaceKey, relationships);
      return { entityId: `${input.canonicalPlaceKey}:${contactDependency}`, changed };
    } },
  };
}

describe("places and contacts migration release gate", () => {
  it("consolidates exact places, queues non-exact work, and applies the auto-approved group idempotently without Act! writes", async () => {
    const records = [
      record("company", { id: "PLACE-C", name: "Adventure Fair, Inc.", address: { line1: "123 Main St.", city: "Denver", state: "CO" } }),
      record("company", { id: "PLACE-A", name: " adventure fair inc ", address: { line1: "123 Main St", city: "Denver", state: "CO" } }),
      record("company", { id: "PLACE-B", name: "Adventure Fair Inc", address: { line1: "123 Main St", city: "Denver", state: "CO" } }),
      record("company", { id: "PLACE-NEAR", name: "Adventure Fair", address: { line1: "999 Broadway", city: "Boulder", state: "CO" } }),
      record("contact", { id: "CONTACT-SHARED", firstName: "Ada", lastName: "Shared", emailAddress: "ada@example.test" }),
      record("contact", { id: "CONTACT-UNIQUE", firstName: "Bea", lastName: "Unique", emailAddress: "bea@example.test" }),
      record("company_contact", { sourceId: "PLACE-A", targetSourceId: "CONTACT-SHARED" }),
      record("company_contact", { sourceId: "PLACE-B", targetSourceId: "CONTACT-SHARED" }),
      record("company_contact", { sourceId: "PLACE-C", targetSourceId: "CONTACT-UNIQUE" }),
    ];
    const source = {
      runId,
      records,
      checkpoints: [{ status: "complete" }],
      sourceDigest: sourceSnapshotDigest(records),
    };
    let previewInput: { proposals: readonly MigrationApplyProposal[] } | null = null;
    const previewService = new ActMigrationPreviewService(
      { finalizeSourceSnapshot: vi.fn().mockResolvedValue(source) } as never,
      { loadCandidateSnapshot: vi.fn().mockResolvedValue(emptyCandidates()) } as never,
      {
        getPreviewIfStored: vi.fn().mockResolvedValue(null),
        storeProposalsIfAbsent: vi.fn().mockImplementation(async (input) => {
          previewInput = input;
          return { changed: true };
        }),
        getPreview: vi.fn().mockResolvedValue({ runId, rows: [], total: 0 }),
      } as never,
    );

    await previewService.finalizePreview(runId);
    const proposals = previewInput!.proposals;
    const canonicalPlace = proposals.find(
      ({ proposalKey }) => proposalKey === "organization:company:PLACE-A",
    );
    const nearMatch = proposals.find(
      ({ proposalKey }) => proposalKey === "organization:company:PLACE-NEAR",
    );

    expect(canonicalPlace).toMatchObject({
      duplicateSourceIds: ["PLACE-A", "PLACE-B", "PLACE-C"],
      sourceRecordKeys: ["company:PLACE-A", "company:PLACE-B", "company:PLACE-C"],
      reviewState: "decided",
    });
    expect(proposals.filter(({ targetEntityType }) => targetEntityType === "organization")).toHaveLength(2);
    expect(nearMatch).toMatchObject({ state: "possible_duplicate", reviewState: "pending" });
    const consolidatedRelationships = proposals.filter(
      ({ targetEntityType }) => targetEntityType === "organization_contact",
    );
    expect(consolidatedRelationships).toHaveLength(2);
    expect(consolidatedRelationships).toEqual(expect.arrayContaining([
      expect.objectContaining({
        sourceRecordKeys: [
          "company_contact:PLACE-A:CONTACT-SHARED",
          "company_contact:PLACE-B:CONTACT-SHARED",
        ],
        reviewState: "pending",
      }),
    ]));

    const reviewed = proposals.map((proposal) => ({
      ...proposal,
      decision: null,
      primarySourceId: null,
      chosenLocalEntityId: null,
    })) satisfies MigrationApplyProposal[];
    const manifest = buildMigrationApplyManifest({
      sourceDigest: source.sourceDigest,
      previewSourceDigest: source.sourceDigest,
      previewProposalDigest: proposalSnapshotDigest(reviewed),
      proposals: reviewed,
      stableLinks: [],
    });

    expect(manifest.counts).toMatchObject({ proposalTotal: 6, runnable: 1, pending: 5 });
    expect(manifest.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ proposalKey: "organization:company:PLACE-NEAR" }),
    ]));

    const applyRepository = new PersistentApplyRepository(reviewed);
    const started = await new ActMigrationApplyService(applyRepository, {}).start({
      requestKey: "33333333-3333-4333-8333-333333333333",
      runId,
      requestedBy: "owner",
      manifest,
    });
    expect(started).toMatchObject({ changed: true, counts: { pending: 1, total: 1 } });

    const relationshipOperations = applyRepository.storedOperations().filter(
      ({ targetEntityType }) => targetEntityType === "organization_contact",
    );
    expect(relationshipOperations).toHaveLength(0);

    const commandCenter = {
      places: new Map<string, Set<string>>(),
      contacts: new Set<string>(),
      placeContacts: new Map<string, Set<string>>(),
    };
    const act = new ReadOnlyActMutator();
    const applyService = new ActMigrationApplyService(
      applyRepository,
      commandCenterTargets({
        commandCenter,
        canonicalPlaceKey: canonicalPlace!.proposalKey,
        act,
      }),
    );

    const firstApply = await applyService.continue({ runId, batchId });
    const replay = await applyService.continue({ runId, batchId });

    expect(firstApply).toMatchObject({ changed: true, counts: { applied: 1, total: 1 } });
    expect(replay).toMatchObject({ changed: false, counts: { applied: 1, total: 1 } });
    expect(applyRepository.storedOperations().every(({ status }) => status === "applied")).toBe(true);
    expect(commandCenter.places).toHaveLength(1);
    expect(commandCenter.places.get(canonicalPlace!.proposalKey)).toEqual(new Set(["PLACE-A", "PLACE-B", "PLACE-C"]));
    expect(commandCenter.contacts).toEqual(new Set());
    expect(commandCenter.placeContacts).toEqual(new Map());
    expect(act.write).not.toHaveBeenCalled();
  });
});
