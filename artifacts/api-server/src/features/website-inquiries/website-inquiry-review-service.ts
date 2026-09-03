import type {
  WebsiteInquiryAlertState,
  WebsiteInquiryStatus,
} from "@/db/schema";
import type { AuditChange, StoredAuditEntry } from "../audit/audit-service";
import type { WebsiteInquiryActor } from "./website-inquiry-authorization";

export type { WebsiteInquiryActor } from "./website-inquiry-authorization";

export type WebsiteInquiryReviewAction =
  | "begin_review"
  | "archive"
  | "spam"
  | "restore";

export type WebsiteInquiryReviewRecord = {
  id: string;
  submissionId: string;
  referenceCode: string;
  status: WebsiteInquiryStatus;
  name: string;
  email: string;
  eventName: string;
  eventDate: string | null;
  eventLocation: string | null;
  packageInterest: string | null;
  message: string;
  pageUrl: string;
  sourceOrigin: string;
  reviewedByKind: "owner" | "office" | null;
  reviewedById: string | null;
  reviewedByName: string | null;
  reviewedAt: Date | null;
  convertedContactId: string | null;
  convertedOrganizationId: string | null;
  convertedBookingId: string | null;
  convertedAt: Date | null;
  alertState: WebsiteInquiryAlertState;
  alertAttemptCount: number;
  alertLastAttemptAt: Date | null;
  alertFailureReason: string | null;
  alertDeliveredRecipients: string[];
  createdAt: Date;
  updatedAt: Date;
};

export type WebsiteInquiryListItem = Omit<
  WebsiteInquiryReviewRecord,
  | "submissionId"
  | "message"
  | "pageUrl"
  | "sourceOrigin"
  | "alertDeliveredRecipients"
>;

export type WebsiteInquiryDetail = {
  inquiry: WebsiteInquiryReviewRecord;
  auditHistory: StoredAuditEntry[];
};

export interface WebsiteInquiryStatusTransaction {
  getForUpdate(id: string): Promise<WebsiteInquiryReviewRecord | null>;
  updateStatus(input: {
    id: string;
    status: WebsiteInquiryStatus;
    actor: WebsiteInquiryActor;
    now: Date;
  }): Promise<WebsiteInquiryReviewRecord>;
  recordAuditEntry(change: AuditChange): Promise<void>;
}

export interface WebsiteInquiryReviewRepository {
  list(input: {
    status?: WebsiteInquiryStatus;
    before: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<{ items: WebsiteInquiryListItem[]; nextCursor: string | null }>;
  countNew(): Promise<number>;
  getDetail(id: string): Promise<WebsiteInquiryDetail | null>;
  runStatusTransaction<T>(
    operation: (transaction: WebsiteInquiryStatusTransaction) => Promise<T>,
  ): Promise<T>;
}

export class WebsiteInquiryNotFoundError extends Error {
  constructor() {
    super("Website inquiry not found.");
    this.name = "WebsiteInquiryNotFoundError";
  }
}

export class WebsiteInquiryTransitionError extends Error {
  constructor() {
    super("That inquiry status change is not allowed.");
    this.name = "WebsiteInquiryTransitionError";
  }
}

export function parseWebsiteInquiryCursor(value: string): {
  createdAt: Date;
  id: string;
} | null {
  const separator = value.lastIndexOf(",");
  if (separator < 1) return null;
  const createdAt = new Date(value.slice(0, separator));
  const id = value.slice(separator + 1);
  if (
    Number.isNaN(createdAt.getTime()) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    return null;
  }
  return { createdAt, id };
}

const transitions: Record<
  WebsiteInquiryReviewAction,
  { from: WebsiteInquiryStatus[]; to: WebsiteInquiryStatus }
> = {
  begin_review: { from: ["new"], to: "reviewing" },
  archive: { from: ["new", "reviewing"], to: "archived" },
  spam: { from: ["new", "reviewing"], to: "spam" },
  restore: { from: ["archived", "spam"], to: "new" },
};

export class WebsiteInquiryReviewService {
  constructor(
    private readonly dependencies: {
      repository: WebsiteInquiryReviewRepository;
      now?: () => Date;
    },
  ) {}

  list(input: {
    status?: WebsiteInquiryStatus;
    cursor?: string;
    limit: number;
  }) {
    return this.dependencies.repository.list({
      status: input.status,
      before: input.cursor ? parseWebsiteInquiryCursor(input.cursor) : null,
      limit: input.limit,
    });
  }

  async count(): Promise<{ newCount: number }> {
    return { newCount: await this.dependencies.repository.countNew() };
  }

  async detail(inquiryId: string): Promise<WebsiteInquiryDetail> {
    const detail = await this.dependencies.repository.getDetail(inquiryId);
    if (!detail) throw new WebsiteInquiryNotFoundError();
    return detail;
  }

  async changeStatus(input: {
    inquiryId: string;
    action: WebsiteInquiryReviewAction;
    actor: WebsiteInquiryActor;
  }): Promise<WebsiteInquiryReviewRecord> {
    const transition = transitions[input.action];
    const now = this.dependencies.now?.() ?? new Date();
    return this.dependencies.repository.runStatusTransaction(
      async (transaction) => {
        const current = await transaction.getForUpdate(input.inquiryId);
        if (!current) throw new WebsiteInquiryNotFoundError();
        if (!transition.from.includes(current.status)) {
          throw new WebsiteInquiryTransitionError();
        }
        const updated = await transaction.updateStatus({
          id: input.inquiryId,
          status: transition.to,
          actor: input.actor,
          now,
        });
        await transaction.recordAuditEntry({
          entityType: "website_inquiry",
          entityId: input.inquiryId,
          action: input.action,
          before: { status: current.status },
          after: { status: transition.to, actor: input.actor },
        });
        return updated;
      },
    );
  }
}
