import type {
  BusinessDocumentCategory,
  BusinessDocumentReviewState,
} from "@workspace/db";

import { BusinessDocumentRepository } from "./business-document-repository";
import { BusinessDocumentStorage } from "./business-document-storage";
import type { BusinessDocumentReviewAction, DocumentLinkInput } from "./business-document-types";

type Repository = Pick<
  BusinessDocumentRepository,
  | "list"
  | "getById"
  | "getOpenableFile"
  | "addLink"
  | "removeLink"
  | "archive"
  | "softDelete"
  | "countPendingReviews"
  | "listPendingReviews"
  | "actOnReview"
>;

type Storage = Pick<BusinessDocumentStorage, "signedReadUrl">;

export class BusinessDocumentService {
  private readonly repository: Repository;
  private readonly storage: Storage;

  constructor(options: { repository?: Repository; storage?: Storage } = {}) {
    this.repository = options.repository ?? new BusinessDocumentRepository();
    this.storage = options.storage ?? new BusinessDocumentStorage();
  }

  list(input: {
    profileId?: string;
    category?: BusinessDocumentCategory;
    reviewState?: BusinessDocumentReviewState;
    limit?: number;
  }) {
    return this.repository.list(input);
  }

  async detail(documentId: string) {
    const document = await this.repository.getById(documentId);
    if (!document) throw new Error("BUSINESS_DOCUMENT_NOT_FOUND");
    return document;
  }

  async open(documentId: string) {
    const file = await this.repository.getOpenableFile(documentId);
    if (!file) throw new Error("BUSINESS_DOCUMENT_FILE_UNAVAILABLE");
    return this.storage.signedReadUrl(file.storageKey, 900);
  }

  addLink(documentId: string, link: DocumentLinkInput, actor: string) {
    return this.repository.addLink(documentId, link, actor);
  }

  async unlink(documentId: string, linkId: string, _actor: string) {
    return this.repository.removeLink(documentId, linkId);
  }

  archive(documentId: string, actor: string) {
    return this.repository.archive(documentId, actor);
  }

  delete(documentId: string, actor: string) {
    return this.repository.softDelete(documentId, actor);
  }

  pendingReviewCount() {
    return this.repository.countPendingReviews();
  }

  reviewItems(limit?: number) {
    return this.repository.listPendingReviews(limit);
  }

  async reviewAction(reviewId: string, action: BusinessDocumentReviewAction, actor: string) {
    const applied = await this.repository.actOnReview(reviewId, action, actor);
    if (!applied) throw new Error("BUSINESS_DOCUMENT_REVIEW_NOT_FOUND");
    return { ok: true as const };
  }
}
