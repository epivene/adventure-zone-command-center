import type { BusinessDocumentTargetKind } from "@workspace/db";

export type EvidenceStrength = "strong" | "supporting" | "conflicting";

export type DocumentLinkProposal = {
  targetKind: BusinessDocumentTargetKind;
  targetId: string;
  confidence: number;
  decision: "auto" | "review";
  evidence: Array<{
    kind: string;
    strength: EvidenceStrength;
    value: string;
  }>;
};

export type BusinessDocumentCrmEvidence = {
  approvedThreadProfileId: string | null;
  exactEmailProfileIds: string[];
  exactEventMatches: Array<{
    targetKind: "booking" | "event_family";
    targetId: string;
  }>;
  fuzzyNameMatches: string[];
};

export function matchBusinessDocument(
  evidence: BusinessDocumentCrmEvidence,
): DocumentLinkProposal[] {
  const strong = new Map<string, DocumentLinkProposal>();
  const addStrong = (
    targetKind: BusinessDocumentTargetKind,
    targetId: string,
    kind: string,
  ) => {
    const key = `${targetKind}:${targetId}`;
    const existing = strong.get(key);
    const item = { kind, strength: "strong" as const, value: targetId };
    if (existing) existing.evidence.push(item);
    else {
      strong.set(key, {
        targetKind,
        targetId,
        confidence: 1,
        decision: "auto",
        evidence: [item],
      });
    }
  };

  if (evidence.approvedThreadProfileId) {
    addStrong("profile", evidence.approvedThreadProfileId, "approved_thread_profile");
  }
  for (const profileId of evidence.exactEmailProfileIds) {
    addStrong("profile", profileId, "exact_contact_email");
  }
  for (const match of evidence.exactEventMatches) {
    addStrong(match.targetKind, match.targetId, "exact_event_identity");
  }

  const strongProposals = [...strong.values()];
  if (strongProposals.length > 1) {
    return strongProposals.map((proposal) => ({
      ...proposal,
      confidence: 0.5,
      decision: "review",
      evidence: proposal.evidence.map((item) => ({ ...item, strength: "conflicting" as const })),
    }));
  }
  if (strongProposals.length === 1) return strongProposals;

  return [...new Set(evidence.fuzzyNameMatches)].map((targetId) => ({
    targetKind: "profile" as const,
    targetId,
    confidence: 0.45,
    decision: "review" as const,
    evidence: [{ kind: "fuzzy_name", strength: "supporting" as const, value: targetId }],
  }));
}
