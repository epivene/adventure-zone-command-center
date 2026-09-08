import type { BusinessDocumentCategory } from "@workspace/db";
import { classifyBusinessDocument } from "./business-document-classifier";
import {
  matchBusinessDocument,
  type BusinessDocumentCrmEvidence,
} from "./business-document-matcher";
import { BusinessDocumentRepository } from "./business-document-repository";
import { BusinessDocumentStorage } from "./business-document-storage";
import type {
  BusinessDocumentIngestInput,
  DocumentIngestionOutcome,
  DocumentSourceIdentity,
  StoredBusinessDocumentBlob,
} from "./business-document-types";

export type BusinessDocumentCandidate = {
  bytes?: Uint8Array;
  storedBlob?: StoredBusinessDocumentBlob;
  filename: string;
  mimeType: string;
  subject: string;
  bodyText: string;
  source: DocumentSourceIdentity;
  evidence: BusinessDocumentCrmEvidence;
  actor: string;
  requireRelationshipReview?: boolean;
  uploadMetadata?: { displayName: string; category: BusinessDocumentCategory };
};

type Storage = {
  putIfAbsent(bytes: Uint8Array, mimeType: string): Promise<StoredBusinessDocumentBlob>;
};
type Repository = {
  ingest(input: BusinessDocumentIngestInput): Promise<DocumentIngestionOutcome>;
};

export class BusinessDocumentIngestion {
  private readonly storage: Storage;
  private readonly repository: Repository;

  constructor(options: { storage?: Storage; repository?: Repository } = {}) {
    this.storage = options.storage ?? new BusinessDocumentStorage();
    this.repository = options.repository ?? new BusinessDocumentRepository();
  }

  async ingest(
    candidate: BusinessDocumentCandidate,
  ): Promise<DocumentIngestionOutcome | { outcome: "skipped"; errorCode: string }> {
    const classification = classifyBusinessDocument(candidate);
    if (classification.decision === "skip" && !candidate.uploadMetadata) {
      return { outcome: "skipped", errorCode: classification.errorCode };
    }
    if (!candidate.storedBlob && (!candidate.bytes || candidate.bytes.byteLength === 0)) {
      return { outcome: "skipped", errorCode: "business_document_empty_file" };
    }

    const proposals = matchBusinessDocument(candidate.evidence);
    const ambiguousLink = proposals.some((proposal) => proposal.decision === "review") || Boolean(candidate.requireRelationshipReview && !proposals.some((proposal) => proposal.decision === "auto"));
    const reviewState =
      (candidate.uploadMetadata || classification.decision === "auto") && !ambiguousLink
        ? "accepted" as const
        : "needs_review" as const;
    const blob = candidate.storedBlob ?? await this.storage.putIfAbsent(candidate.bytes!, candidate.mimeType);

    return this.repository.ingest({
      displayName: candidate.uploadMetadata?.displayName ?? (candidate.filename.replace(/\.[^.]+$/, "").trim() || candidate.filename),
      originalFilename: candidate.filename,
      category: candidate.uploadMetadata?.category ?? classification.category,
      reviewState,
      actor: candidate.actor,
      blob,
      source: candidate.source,
      links: proposals
        .filter((proposal) => proposal.decision === "auto")
        .map((proposal) => ({
          targetKind: proposal.targetKind,
          targetId: proposal.targetId,
          confirmationMode: "automatic" as const,
          confidence: proposal.confidence,
          evidence: proposal.evidence,
        })),
      notes: null,
      preserveMetadataOnDuplicate: Boolean(candidate.uploadMetadata),
    });
  }
}
