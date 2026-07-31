import { createHash } from "node:crypto";

import {
  allowedDecisionsForProposal,
  migrationTargetEntityTypeValues,
  migrationTargetRank,
  type MigrationTargetEntityType,
} from "@/features/act-migration/migration-types";
import {
  proposalSnapshotDigest,
} from "@/features/act-migration/reconciliation";
import type {
  MigrationApplyCounts,
  MigrationApplyManifest,
  MigrationApplyManifestEntry,
  MigrationApplyManifestInput,
  MigrationApplyProposal,
  MigrationApplyTargetCounts,
} from "@/features/act-migration/apply-types";

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalValue(child)]),
  );
}

function digest(value: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

function emptyTargetCounts(): MigrationApplyTargetCounts {
  return { runnable: 0, reconciled: 0, ignored: 0, pending: 0, failed: 0 };
}

function emptyCounts(): MigrationApplyCounts {
  return {
    proposalTotal: 0,
    ...emptyTargetCounts(),
    byTarget: Object.fromEntries(
      migrationTargetEntityTypeValues.map((target) => [
        target,
        emptyTargetCounts(),
      ]),
    ) as Record<MigrationTargetEntityType, MigrationApplyTargetCounts>,
  };
}

function increment(
  counts: MigrationApplyCounts,
  target: MigrationTargetEntityType,
  key: keyof MigrationApplyTargetCounts,
) {
  counts[key] += 1;
  counts.byTarget[target][key] += 1;
}

function hasCanonicalStableLinks(
  proposal: MigrationApplyProposal,
  input: MigrationApplyManifestInput,
) {
  if (proposal.proposedLocalId === null) return false;
  return proposal.sourceRecordKeys.every((sourceRecordKey) =>
    input.stableLinks.some(
      (link) =>
        link.targetEntityType === proposal.targetEntityType &&
        link.localEntityId === proposal.proposedLocalId &&
        link.sourceRecordKey === sourceRecordKey,
    ),
  );
}

function isUnconfirmedStaticGroup(proposal: MigrationApplyProposal) {
  return proposal.targetEntityType === "calling_list" &&
    proposal.issueCode === "group_membership_semantics_unknown" &&
    proposal.decision !== "ignore" &&
    proposal.decision !== "confirm_static_group";
}

function isDecisionValid(proposal: MigrationApplyProposal) {
  return allowedDecisionsForProposal({
    state: proposal.state,
    targetEntityType: proposal.targetEntityType,
    issueCode: proposal.issueCode,
    candidateLocalIds: proposal.candidateLocalIds,
  }).includes(proposal.decision!);
}

function manifestPayload(manifest: Omit<MigrationApplyManifest, "digest">) {
  return {
    sourceDigest: manifest.sourceDigest,
    previewProposalDigest: manifest.previewProposalDigest,
    entries: manifest.entries,
    counts: manifest.counts,
  };
}

export function migrationApplyManifestDigest(
  manifest: MigrationApplyManifest,
) {
  return digest(manifestPayload(manifest));
}

export function buildMigrationApplyManifest(
  input: MigrationApplyManifestInput,
): MigrationApplyManifest {
  if (input.sourceDigest !== input.previewSourceDigest) {
    throw new Error(
      "Act migration source digest does not match the reviewed preview digest.",
    );
  }
  if (proposalSnapshotDigest(input.proposals) !== input.previewProposalDigest) {
    throw new Error(
      "Act migration proposal digest does not match the reviewed preview digest.",
    );
  }

  const proposalKeys = new Set(input.proposals.map(({ proposalKey }) => proposalKey));
  if (proposalKeys.size !== input.proposals.length) {
    throw new Error("Act migration preview contains duplicate proposal keys.");
  }
  const resolvedProposalKeys = new Set(input.resolvedProposalKeys ?? []);
  for (const proposal of input.proposals) {
    for (const dependencyKey of proposal.dependencyProposalKeys) {
      if (
        dependencyKey === proposal.proposalKey ||
        (!proposalKeys.has(dependencyKey) && !resolvedProposalKeys.has(dependencyKey))
      ) {
        throw new Error(
          "Act migration proposal dependency is absent from the reviewed preview.",
        );
      }
    }
  }

  const counts = emptyCounts();
  counts.proposalTotal = input.proposals.length;
  const entries: MigrationApplyManifestEntry[] = [];
  for (const proposal of input.proposals) {
    if (proposal.state === "matched_unchanged") {
      if (!hasCanonicalStableLinks(proposal, input)) {
        throw new Error(
          "Act migration matched_unchanged proposal is missing a canonical stable link.",
        );
      }
      increment(counts, proposal.targetEntityType, "reconciled");
      continue;
    }
    if (proposal.state === "error") {
      increment(counts, proposal.targetEntityType, "failed");
      continue;
    }
    if (proposal.state === "ignored" || proposal.decision === "ignore") {
      increment(counts, proposal.targetEntityType, "ignored");
      continue;
    }
    if (isUnconfirmedStaticGroup(proposal)) {
      throw new Error(
        "Act migration Group proposals require an individual static Group confirmation.",
      );
    }
    if (proposal.decision === null) {
      increment(counts, proposal.targetEntityType, "pending");
      continue;
    }
    if (!isDecisionValid(proposal)) {
      throw new Error("Act migration proposal has an invalid reviewed decision.");
    }
    entries.push({
      proposalKey: proposal.proposalKey,
      decision: proposal.decision,
      chosenLocalEntityId: proposal.chosenLocalEntityId,
      primarySourceId: proposal.primarySourceId,
      targetEntityType: proposal.targetEntityType,
      sourceRecordKeys: [...proposal.sourceRecordKeys].toSorted(),
      dependencyProposalKeys: [...proposal.dependencyProposalKeys].toSorted(),
      operationRank: migrationTargetRank(proposal.targetEntityType),
    });
    increment(counts, proposal.targetEntityType, "runnable");
  }

  entries.sort(
    (left, right) =>
      left.operationRank - right.operationRank ||
      left.proposalKey.localeCompare(right.proposalKey),
  );
  const manifestWithoutDigest = {
    sourceDigest: input.sourceDigest,
    previewProposalDigest: input.previewProposalDigest,
    entries,
    counts,
  };
  return {
    ...manifestWithoutDigest,
    digest: digest(manifestPayload(manifestWithoutDigest)),
  };
}
