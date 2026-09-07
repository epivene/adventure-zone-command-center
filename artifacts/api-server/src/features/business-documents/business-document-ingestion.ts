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
  bytes: Uint8Array;
  filename: string;
  mimeType: string;
  subject: string;
  bodyText: string;
  source: DocumentSourceIdentity;
  evidence: BusinessDocumentCrmEvidence;
  actor: string;
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
    if (classification.decision === "skip") {
      return { outcome: "skipped", errorCode: classification.errorCode };
    }
    if (candidate.bytes.byteLength === 0) {
      return { outcome: "skipped", errorCode: "business_document_empty_file" };
    }

    const proposals = matchBusinessDocument(candidate.evidence);
    const ambiguousLink = proposals.some((proposal) => proposal.decision === "review");
    const reviewState =
      classification.decision === "auto" && !ambiguousLink
        ? "accepted" as const
        : "needs_review" as const;
    const blob = await this.storage.putIfAbsent(candidate.bytes, candidate.mimeType);

    return this.repository.ingest({
      displayName: candidate.filename.replace(/\.[^.]+$/, "").trim() || candidate.filename,
      originalFilename: candidate.filename,
      category: classification.category,
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
    });
  }
}
