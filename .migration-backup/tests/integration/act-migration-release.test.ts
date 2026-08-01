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
      name: "10 Mile Pride Festival",
      normalizedName: "10 mile pride festival",
      placeType: "other",
      actIndustry: null,
      phone: null,
      normalizedPhone: null,
      address1: "12 Main Street",
      address2: null,
      city: "Frisco",
      region: "CO",
      normalizedCity: "frisco",
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

class ReadOnlyActAdapter {
  readonly writes = vi.fn();
}

type EventProfileState = {
  sourceIds: string[];
  phones: string[];
  notes: string[];
  contactSourceIds: string[];
};

type ContactState = {
  sourceIds: string[];
  phones: string[];
  emails: string[];
};

/** Stateful local Command Center target used by the release gate. */
class StatefulCommandCenter {
  readonly profiles = new Map<string, EventProfileState>();
  readonly contacts = new Map<string, ContactState>();
  readonly relationships = new Set<string>();

  constructor(private readonly act: ReadOnlyActAdapter) {}

  private assertLocalOnly() {
    expect(this.act.writes).not.toHaveBeenCalled();
  }

  private array(snapshot: Record<string, unknown>, key: string) {
    const value = snapshot[key];
    if (typeof value !== "string") return [];
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
      ? [...new Set(parsed)]
      : [];
  }

  targets() {
    return {
      organization: { apply: async (operation: MigrationApplyOperation) => {
        this.assertLocalOnly();
        const snapshot = operation.proposal.displaySnapshot;
        const next: EventProfileState = {
          sourceIds: [...(operation.proposal.duplicateSourceIds ?? [])],
          phones: this.array(snapshot, "mergedPhones"),
          notes: this.array(snapshot, "mergedNotes"),
          contactSourceIds: this.array(snapshot, "mergedContactSourceIds"),
        };
        const previous = this.profiles.get(operation.proposalKey);
        this.profiles.set(operation.proposalKey, next);
        return { entityId: operation.proposalKey, changed: JSON.stringify(previous) !== JSON.stringify(next) };
      } },
      contact: { apply: async (operation: MigrationApplyOperation) => {
        this.assertLocalOnly();
        const sourceIds = operation.proposal.sourceRecordKeys
          .filter((key) => key.startsWith("contact:"))
          .map((key) => key.slice("contact:".length));
        const snapshot = operation.proposal.displaySnapshot;
        const next: ContactState = {
          sourceIds,
          phones: this.array(snapshot, "phones"),
          emails: this.array(snapshot, "emails"),
        };
        const previous = this.contacts.get(operation.proposalKey);
        this.contacts.set(operation.proposalKey, next);
        return { entityId: operation.proposalKey, changed: JSON.stringify(previous) !== JSON.stringify(next) };
      } },
      organization_contact: { apply: async (operation: MigrationApplyOperation) => {
        this.assertLocalOnly();
        const organization = operation.dependencyProposalKeys.find((key) => key.startsWith("organization:"));
        const contact = operation.dependencyProposalKeys.find((key) => key.startsWith("contact:"));
        if (!organization || !contact) throw new Error("Release fixture relationship dependencies are missing.");
        const key = `${organization}:${contact}`;
        const changed = !this.relationships.has(key);
        this.relationships.add(key);
        return { entityId: key, changed };
      } },
    };
  }
}

describe("event profile migration release gate", () => {
  it("consolidates the 10 Mile Pride profile, leaves only its near-match queued, and replays local apply without Act! writes", async () => {
    const records = [
      record("company", { id: "PRIDE-C", name: "10 Mile Pride", phone: "970-555-0103", notes: "Prefers a Saturday headline.", address: { line1: "10 Main St", city: "Breckenridge", state: "CO" } }),
      record("company", { id: "PRIDE-A", name: " 10 mile pride ", phone: "970-555-0101", notes: "Requested a sponsor packet.", address: { line1: "10 Main St.", city: "Breckenridge", state: "CO" } }),
      record("company", { id: "PRIDE-B", name: "10 MILE PRIDE", phone: "970-555-0102", notes: "Call the events team after Labor Day.", address: { line1: "10 Main St", city: "Breckenridge", state: "CO" } }),
      record("company", { id: "PRIDE-NEAR", name: "10 Mile Pride Festival", address: { line1: "11 Main Street", city: "Frisco", state: "CO" } }),
      record("contact", { id: "CONTACT-SHARED", firstName: "Avery", lastName: "Able", emailAddress: "avery@example.test", businessPhone: "970-555-0111", notes: "Primary coordinator." }),
      record("contact", { id: "CONTACT-UNIQUE", firstName: "Bailey", lastName: "Baker", emailAddress: "bailey@example.test", businessPhone: "970-555-0112", notes: "Works vendor check-in." }),
      record("company_contact", { sourceId: "PRIDE-A", targetSourceId: "CONTACT-SHARED" }),
      record("company_contact", { sourceId: "PRIDE-B", targetSourceId: "CONTACT-SHARED" }),
      record("company_contact", { sourceId: "PRIDE-C", targetSourceId: "CONTACT-UNIQUE" }),
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
      ({ proposalKey }) => proposalKey === "organization:company:PRIDE-A",
    );
    const nearMatch = proposals.find(
      ({ proposalKey }) => proposalKey === "organization:company:PRIDE-NEAR",
    );

    expect(canonicalPlace).toMatchObject({
      duplicateSourceIds: ["PRIDE-A", "PRIDE-B", "PRIDE-C"],
      sourceRecordKeys: ["company:PRIDE-A", "company:PRIDE-B", "company:PRIDE-C"],
      reviewState: "decided",
      displaySnapshot: expect.objectContaining({
        mergedContactSourceIds: '["CONTACT-SHARED","CONTACT-UNIQUE"]',
        mergedPhones: '["970-555-0101","970-555-0102","970-555-0103","970-555-0111","970-555-0112"]',
        mergedNotes: '["Call the events team after Labor Day.","Prefers a Saturday headline.","Primary coordinator.","Requested a sponsor packet.","Works vendor check-in."]',
      }),
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
          "company_contact:PRIDE-A:CONTACT-SHARED",
          "company_contact:PRIDE-B:CONTACT-SHARED",
        ],
        reviewState: "decided",
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

    expect(manifest.counts).toMatchObject({ proposalTotal: 6, runnable: 5, pending: 1 });
    expect(manifest.entries.map(({ proposalKey }) => proposalKey)).toEqual(expect.arrayContaining([
      canonicalPlace!.proposalKey,
      ...consolidatedRelationships.map(({ proposalKey }) => proposalKey),
    ]));
    expect(manifest.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ proposalKey: nearMatch!.proposalKey }),
    ]));

    const applyRepository = new PersistentApplyRepository(reviewed);
    const started = await new ActMigrationApplyService(applyRepository, {}).start({
      requestKey: "33333333-3333-4333-8333-333333333333",
      runId,
      requestedBy: "owner",
      manifest,
    });
    expect(started).toMatchObject({ changed: true, counts: { pending: 5, total: 5 } });

    const act = new ReadOnlyActAdapter();
    const commandCenter = new StatefulCommandCenter(act);
    const applyService = new ActMigrationApplyService(
      applyRepository,
      commandCenter.targets(),
    );

    const firstApply = await applyService.continue({ runId, batchId });
    const replay = await applyService.continue({ runId, batchId });

    expect(firstApply).toMatchObject({ changed: true, counts: { applied: 5, total: 5 } });
    expect(replay).toMatchObject({ changed: false, counts: { applied: 5, total: 5 } });
    expect(applyRepository.storedOperations().every(({ status }) => status === "applied")).toBe(true);
    expect(commandCenter.profiles).toHaveLength(1);
    expect(commandCenter.profiles.get(canonicalPlace!.proposalKey)).toEqual({
      sourceIds: ["PRIDE-A", "PRIDE-B", "PRIDE-C"],
      phones: ["970-555-0101", "970-555-0102", "970-555-0103", "970-555-0111", "970-555-0112"],
      notes: ["Call the events team after Labor Day.", "Prefers a Saturday headline.", "Primary coordinator.", "Requested a sponsor packet.", "Works vendor check-in."],
      contactSourceIds: ["CONTACT-SHARED", "CONTACT-UNIQUE"],
    });
    const approvedContactProposalKeys = reviewed
      .filter(({ targetEntityType }) => targetEntityType === "contact")
      .map(({ proposalKey }) => proposalKey);
    expect([...commandCenter.contacts.keys()]).toEqual(expect.arrayContaining(approvedContactProposalKeys));
    expect(commandCenter.contacts).toHaveLength(2);
    expect(commandCenter.relationships).toEqual(new Set([
      `${canonicalPlace!.proposalKey}:contact:contact:CONTACT-SHARED`,
      `${canonicalPlace!.proposalKey}:contact:contact:CONTACT-UNIQUE`,
    ]));
    expect(act.writes).not.toHaveBeenCalled();
  });
});
