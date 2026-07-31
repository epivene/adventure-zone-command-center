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
  return proposal.sourceRecordKeys.every((sourceRecordKey) => {
    const links = input.stableLinks.filter(
      (link) =>
        link.targetEntityType === proposal.targetEntityType &&
        link.sourceRecordKey === sourceRecordKey,
    );
    return links.length === 1 && links[0]!.localEntityId === proposal.proposedLocalId;
  });
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

  type ProposalDisposition = "runnable" | "reconciled" | "ignored" | "pending" | "failed";
  const dispositions = new Map<string, ProposalDisposition>();
  for (const proposal of input.proposals) {
    if (proposal.state === "matched_unchanged") {
      if (!hasCanonicalStableLinks(proposal, input)) {
        // Stable-link ambiguity and absence both leave this proposal unresolved.
        // Other independently approved proposals remain safe to queue.
        dispositions.set(proposal.proposalKey, "pending");
        continue;
      }
      dispositions.set(proposal.proposalKey, "reconciled");
      continue;
    }
    if (proposal.state === "error") {
      dispositions.set(proposal.proposalKey, "failed");
      continue;
    }
    if (proposal.state === "ignored" || proposal.decision === "ignore") {
      dispositions.set(proposal.proposalKey, "ignored");
      continue;
    }
    if (isUnconfirmedStaticGroup(proposal)) {
      throw new Error(
        "Act migration Group proposals require an individual static Group confirmation.",
      );
    }
    if (proposal.decision === null) {
      dispositions.set(proposal.proposalKey, "pending");
      continue;
    }
    if (!isDecisionValid(proposal)) {
      throw new Error("Act migration proposal has an invalid reviewed decision.");
    }
    dispositions.set(proposal.proposalKey, "runnable");
  }

  // A reviewed child cannot safely enter the durable queue while its canonical
  // parent is unresolved. Keeping it pending preserves the group for review
  // instead of creating a permanently blocked operation.
  let changed = true;
  while (changed) {
    changed = false;
    for (const proposal of input.proposals) {
      if (dispositions.get(proposal.proposalKey) !== "runnable") continue;
      const hasUnresolvedDependency = proposal.dependencyProposalKeys.some(
        (dependencyKey) => {
          if (resolvedProposalKeys.has(dependencyKey)) return false;
          const dependency = dispositions.get(dependencyKey);
          return dependency !== "runnable" && dependency !== "reconciled";
        },
      );
      if (hasUnresolvedDependency) {
        dispositions.set(proposal.proposalKey, "pending");
        changed = true;
      }
    }
  }

  const counts = emptyCounts();
  counts.proposalTotal = input.proposals.length;
  const entries: MigrationApplyManifestEntry[] = [];
  const proposalsByKey = new Map(input.proposals.map((proposal) => [
    proposal.proposalKey,
    proposal,
  ]));
  for (const proposal of input.proposals) {
    const disposition = dispositions.get(proposal.proposalKey)!;
    increment(counts, proposal.targetEntityType, disposition);
    if (disposition !== "runnable") continue;
    entries.push({
      proposalKey: proposal.proposalKey,
      canonicalTargetProposalKey: proposal.proposalKey,
      canonicalTargetLocalEntityId:
        proposal.chosenLocalEntityId ?? proposal.proposedLocalId,
      canonicalSourceIds: [...(proposal.duplicateSourceIds ?? [])].toSorted(),
      decision: proposal.decision!,
      chosenLocalEntityId: proposal.chosenLocalEntityId,
      primarySourceId: proposal.primarySourceId,
      targetEntityType: proposal.targetEntityType,
      sourceRecordKeys: [...proposal.sourceRecordKeys].toSorted(),
      dependencyProposalKeys: [...proposal.dependencyProposalKeys].toSorted(),
      resolvedDependencies: proposal.dependencyProposalKeys.flatMap((dependencyKey) => {
        if (dispositions.get(dependencyKey) !== "reconciled") return [];
        const dependency = proposalsByKey.get(dependencyKey);
        if (!dependency?.proposedLocalId) return [];
        return [{
          proposalKey: dependencyKey,
          targetEntityType: dependency.targetEntityType,
          entityId: dependency.proposedLocalId,
        }];
      }).toSorted((left, right) => left.proposalKey.localeCompare(right.proposalKey)),
      operationRank: migrationTargetRank(proposal.targetEntityType),
    });
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
