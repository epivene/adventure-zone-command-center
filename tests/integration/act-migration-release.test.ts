import { describe, expect, it, vi } from "vitest";

import { buildMigrationApplyManifest } from "@/features/act-migration/apply-manifest";
import { ActMigrationApplyService } from "@/features/act-migration/apply-service";
import type {
  MigrationApplyOperation,
  MigrationApplyWorkspace,
} from "@/features/act-migration/apply-repository";
import type { MigrationApplyProposal } from "@/features/act-migration/apply-types";
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

function applyOperation(
  proposal: MigrationApplyProposal,
): MigrationApplyOperation {
  return {
    id: `operation:${proposal.proposalKey}`,
    batchId,
    runId,
    proposalKey: proposal.proposalKey,
    targetEntityType: proposal.targetEntityType,
    dependencyProposalKeys: proposal.dependencyProposalKeys,
    resolvedDependencies: [],
    status: "leased",
    attemptCount: 1,
    leaseOwner: "release-fixture-worker",
    leaseExpiresAt: null,
    appliedEntityId: null,
    errorCode: null,
    retryable: true,
    proposal,
  };
}

describe("places and contacts migration release gate", () => {
  it("consolidates exact places, queues the near-match, and applies the approved group idempotently without Act! writes", async () => {
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
    });
    expect(proposals.filter(({ targetEntityType }) => targetEntityType === "organization")).toHaveLength(2);
    expect(nearMatch).toMatchObject({ state: "possible_duplicate", reviewState: "pending" });

    const approved = proposals.map((proposal) =>
      proposal === nearMatch
        ? { ...proposal, decision: null }
        : {
            ...proposal,
            reviewState: "decided" as const,
            decision: "approve_proposed" as const,
            primarySourceId:
              proposal.targetEntityType === "contact"
                ? proposal.sourceRecordKeys[0]!.slice("contact:".length)
                : null,
            chosenLocalEntityId: null,
          },
    ) satisfies MigrationApplyProposal[];
    const manifest = buildMigrationApplyManifest({
      sourceDigest: source.sourceDigest,
      previewSourceDigest: source.sourceDigest,
      // Decisions are persisted before apply and therefore belong to the
      // reviewed preview digest presented to the apply boundary.
      previewProposalDigest: proposalSnapshotDigest(approved),
      proposals: approved,
      stableLinks: [],
    });

    expect(manifest.counts).toMatchObject({ proposalTotal: 7, runnable: 6, pending: 1 });
    expect(manifest.entries).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ proposalKey: "organization:company:PLACE-NEAR" }),
    ]));

    const operations = manifest.entries.map((entry) =>
      applyOperation(approved.find(({ proposalKey }) => proposalKey === entry.proposalKey)!),
    );
    const commandCenter = {
      places: new Map<string, Set<string>>(),
      contacts: new Set<string>(),
      placeContacts: new Set<string>(),
    };
    const actWrites: string[] = [];
    const counts = () => ({
      pending: operations.length,
      leased: 0,
      blocked: 0,
      applied: manifest.entries.length - operations.length,
      ignored: 0,
      failed: 0,
      total: manifest.entries.length,
    });
    const workspace = (): MigrationApplyWorkspace => ({
      runId,
      runStatus: operations.length ? "applying" : "applied",
      counts: counts(),
      batches: [{
        id: batchId,
        requestKey: "33333333-3333-4333-8333-333333333333",
        runId,
        requestedBy: "owner",
        status: operations.length ? "applying" : "applied",
        manifestDigest: manifest.digest,
        summary: counts(),
        lastErrorCode: null,
        startedAt: null,
        completedAt: null,
      }],
    });
    const applyService = new ActMigrationApplyService({
      createBatchIfAbsent: vi.fn(),
      claimNextOperation: vi.fn(async () => operations.shift() ?? null),
      completeOperation: vi.fn(),
      failOperation: vi.fn(),
      releaseExpiredLeases: vi.fn().mockResolvedValue(0),
      getApplyWorkspace: vi.fn(async () => workspace()),
    }, {
      organization: { apply: async (operation) => {
        const sources = commandCenter.places.get(operation.proposalKey) ?? new Set<string>();
        for (const sourceId of operation.proposal.duplicateSourceIds ?? []) sources.add(sourceId);
        commandCenter.places.set(operation.proposalKey, sources);
        return { entityId: operation.proposalKey, changed: sources.size > 0 };
      } },
      contact: { apply: async (operation) => {
        const changed = !commandCenter.contacts.has(operation.proposalKey);
        commandCenter.contacts.add(operation.proposalKey);
        return { entityId: operation.proposalKey, changed };
      } },
      organization_contact: { apply: async (operation) => {
        const contactDependency = operation.dependencyProposalKeys.find((key) => key.startsWith("contact:"));
        const key = `${canonicalPlace!.proposalKey}:${contactDependency}`;
        const changed = !commandCenter.placeContacts.has(key);
        commandCenter.placeContacts.add(key);
        return { entityId: key, changed };
      } },
    });

    const firstApply = await applyService.continue({ runId, batchId });
    const replay = await applyService.continue({ runId, batchId });

    expect(firstApply).toMatchObject({ changed: true, counts: { applied: 6, total: 6 } });
    expect(replay).toMatchObject({ changed: false, counts: { applied: 6, total: 6 } });
    expect(commandCenter.places).toHaveLength(1);
    expect(commandCenter.places.get(canonicalPlace!.proposalKey)).toEqual(new Set(["PLACE-A", "PLACE-B", "PLACE-C"]));
    expect(commandCenter.contacts).toHaveLength(2);
    expect(commandCenter.placeContacts).toHaveLength(2);
    expect(actWrites).toEqual([]);
  });
});
