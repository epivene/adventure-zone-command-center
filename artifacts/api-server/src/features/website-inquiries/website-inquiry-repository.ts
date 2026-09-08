import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  or,
} from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { auditEntries, websiteInquiries } from "@/db/schema";
import { recordAuditEntry } from "../audit/audit-service";
import type {
  NewWebsiteInquiry,
  WebsiteInquiryIntakeRepository,
  WebsiteInquiryReceipt,
} from "./website-inquiry-service";
import type {
  WebsiteInquiryAlertClaim,
  WebsiteInquiryAlertRepository,
} from "./website-inquiry-alert-worker";
import type {
  WebsiteInquiryListItem,
  WebsiteInquiryReviewRecord,
  WebsiteInquiryReviewRepository,
  WebsiteInquiryStatusTransaction,
} from "./website-inquiry-review-service";

const receiptSelection = {
  inquiryId: websiteInquiries.id,
  referenceCode: websiteInquiries.referenceCode,
  createdAt: websiteInquiries.createdAt,
};

const reviewSelection = {
  id: websiteInquiries.id,
  submissionId: websiteInquiries.submissionId,
  referenceCode: websiteInquiries.referenceCode,
  status: websiteInquiries.status,
  name: websiteInquiries.name,
  email: websiteInquiries.email,
  eventName: websiteInquiries.eventName,
  eventDate: websiteInquiries.eventDate,
  eventLocation: websiteInquiries.eventLocation,
  packageInterest: websiteInquiries.packageInterest,
  message: websiteInquiries.message,
  pageUrl: websiteInquiries.pageUrl,
  sourceOrigin: websiteInquiries.sourceOrigin,
  reviewedByKind: websiteInquiries.reviewedByKind,
  reviewedById: websiteInquiries.reviewedById,
  reviewedByName: websiteInquiries.reviewedByName,
  reviewedAt: websiteInquiries.reviewedAt,
  convertedContactId: websiteInquiries.convertedContactId,
  convertedOrganizationId: websiteInquiries.convertedOrganizationId,
  convertedBookingId: websiteInquiries.convertedBookingId,
  convertedAt: websiteInquiries.convertedAt,
  alertState: websiteInquiries.alertState,
  alertAttemptCount: websiteInquiries.alertAttemptCount,
  alertLastAttemptAt: websiteInquiries.alertLastAttemptAt,
  alertFailureReason: websiteInquiries.alertFailureReason,
  alertDeliveredRecipients: websiteInquiries.alertDeliveredRecipients,
  createdAt: websiteInquiries.createdAt,
  updatedAt: websiteInquiries.updatedAt,
};

function listItem(record: WebsiteInquiryReviewRecord): WebsiteInquiryListItem {
  const {
    submissionId: _submissionId,
    message: _message,
    pageUrl: _pageUrl,
    sourceOrigin: _sourceOrigin,
    alertDeliveredRecipients: _alertDeliveredRecipients,
    ...item
  } = record;
  return item;
}

function cursorFor(record: { createdAt: Date; id: string }): string {
  return `${record.createdAt.toISOString()},${record.id}`;
}

export class DrizzleWebsiteInquiryRepository
  implements
    WebsiteInquiryIntakeRepository,
    WebsiteInquiryAlertRepository,
    WebsiteInquiryReviewRepository
{
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async findBySubmissionId(
    submissionId: string,
  ): Promise<WebsiteInquiryReceipt | null> {
    const rows = await this.database
      .select(receiptSelection)
      .from(websiteInquiries)
      .where(eq(websiteInquiries.submissionId, submissionId))
      .limit(1);
    return rows[0] ?? null;
  }

  async findRecentByFingerprint(input: {
    normalizedEmail: string;
    contentFingerprint: string;
    since: Date;
  }): Promise<WebsiteInquiryReceipt | null> {
    const rows = await this.database
      .select(receiptSelection)
      .from(websiteInquiries)
      .where(
        and(
          eq(websiteInquiries.normalizedEmail, input.normalizedEmail),
          eq(websiteInquiries.contentFingerprint, input.contentFingerprint),
          gte(websiteInquiries.createdAt, input.since),
        ),
      )
      .orderBy(desc(websiteInquiries.createdAt))
      .limit(1);
    return rows[0] ?? null;
  }

  async create(input: NewWebsiteInquiry): Promise<WebsiteInquiryReceipt> {
    const [created] = await this.database
      .insert(websiteInquiries)
      .values({
        submissionId: input.submissionId,
        referenceCode: input.referenceCode,
        name: input.name,
        email: input.email,
        normalizedEmail: input.normalizedEmail,
        eventName: input.eventName,
        eventDate: input.eventDate || null,
        eventLocation: input.eventLocation || null,
        packageInterest: input.packageInterest || null,
        message: input.message,
        pageUrl: input.pageUrl,
        sourceOrigin: input.sourceOrigin,
        contentFingerprint: input.contentFingerprint,
      })
      .returning(receiptSelection);
    if (!created) throw new Error("Website inquiry was not persisted");
    return created;
  }

  async claimNextAlert(input: {
    workerId: string;
    now: Date;
    leaseMs: number;
  }): Promise<WebsiteInquiryAlertClaim | null> {
    return this.database.transaction(async (transaction) => {
      const [candidate] = await transaction
        .select({
          id: websiteInquiries.id,
          referenceCode: websiteInquiries.referenceCode,
          name: websiteInquiries.name,
          email: websiteInquiries.email,
          eventName: websiteInquiries.eventName,
          eventDate: websiteInquiries.eventDate,
          eventLocation: websiteInquiries.eventLocation,
          packageInterest: websiteInquiries.packageInterest,
          message: websiteInquiries.message,
          alertAttemptCount: websiteInquiries.alertAttemptCount,
          alertDeliveredRecipients: websiteInquiries.alertDeliveredRecipients,
        })
        .from(websiteInquiries)
        .where(
          or(
            and(
              inArray(websiteInquiries.alertState, ["pending", "retry"]),
              lte(websiteInquiries.alertNextAttemptAt, input.now),
            ),
            and(
              eq(websiteInquiries.alertState, "sending"),
              or(
                isNull(websiteInquiries.alertLeaseExpiresAt),
                lte(websiteInquiries.alertLeaseExpiresAt, input.now),
              ),
            ),
          ),
        )
        .orderBy(
          asc(websiteInquiries.alertNextAttemptAt),
          asc(websiteInquiries.createdAt),
        )
        .limit(1)
        .for("update", { skipLocked: true });
      if (!candidate) return null;

      const alertAttemptCount = candidate.alertAttemptCount + 1;
      await transaction
        .update(websiteInquiries)
        .set({
          alertState: "sending",
          alertAttemptCount,
          alertLastAttemptAt: input.now,
          alertFailureReason: null,
          alertLeaseOwner: input.workerId,
          alertLeaseExpiresAt: new Date(input.now.getTime() + input.leaseMs),
          updatedAt: input.now,
        })
        .where(eq(websiteInquiries.id, candidate.id));

      return {
        ...candidate,
        alertAttemptCount,
        alertLeaseOwner: input.workerId,
      };
    });
  }

  async recordRecipientDelivered(input: {
    inquiryId: string;
    leaseOwner: string;
    recipient: string;
    now: Date;
  }): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [claimed] = await transaction
        .select({
          delivered: websiteInquiries.alertDeliveredRecipients,
        })
        .from(websiteInquiries)
        .where(
          and(
            eq(websiteInquiries.id, input.inquiryId),
            eq(websiteInquiries.alertState, "sending"),
            eq(websiteInquiries.alertLeaseOwner, input.leaseOwner),
          ),
        )
        .limit(1)
        .for("update");
      if (!claimed) throw new Error("Website inquiry alert lease was lost.");
      if (
        claimed.delivered.some(
          (recipient) => recipient.toLowerCase() === input.recipient.toLowerCase(),
        )
      ) {
        return;
      }
      await transaction
        .update(websiteInquiries)
        .set({
          alertDeliveredRecipients: [...claimed.delivered, input.recipient],
          updatedAt: input.now,
        })
        .where(
          and(
            eq(websiteInquiries.id, input.inquiryId),
            eq(websiteInquiries.alertLeaseOwner, input.leaseOwner),
          ),
        );
    });
  }

  async completeAlert(input: {
    inquiryId: string;
    leaseOwner: string;
    now: Date;
  }): Promise<void> {
    await this.database
      .update(websiteInquiries)
      .set({
        alertState: "sent",
        alertFailureReason: null,
        alertLeaseOwner: null,
        alertLeaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(websiteInquiries.id, input.inquiryId),
          eq(websiteInquiries.alertState, "sending"),
          eq(websiteInquiries.alertLeaseOwner, input.leaseOwner),
        ),
      );
  }

  async failAlert(input: {
    inquiryId: string;
    leaseOwner: string;
    now: Date;
    nextAttemptAt: Date | null;
    reason: string;
    terminal: boolean;
  }): Promise<void> {
    await this.database
      .update(websiteInquiries)
      .set({
        alertState: input.terminal ? "failed" : "retry",
        alertNextAttemptAt: input.nextAttemptAt ?? input.now,
        alertFailureReason: input.reason.slice(0, 300),
        alertLeaseOwner: null,
        alertLeaseExpiresAt: null,
        updatedAt: input.now,
      })
      .where(
        and(
          eq(websiteInquiries.id, input.inquiryId),
          eq(websiteInquiries.alertState, "sending"),
          eq(websiteInquiries.alertLeaseOwner, input.leaseOwner),
        ),
      );
  }

  async list(input: {
    status?: WebsiteInquiryReviewRecord["status"];
    before: { createdAt: Date; id: string } | null;
    limit: number;
  }): Promise<{ items: WebsiteInquiryListItem[]; nextCursor: string | null }> {
    const filters = [];
    if (input.status) filters.push(eq(websiteInquiries.status, input.status));
    if (input.before) {
      filters.push(
        or(
          lt(websiteInquiries.createdAt, input.before.createdAt),
          and(
            eq(websiteInquiries.createdAt, input.before.createdAt),
            lt(websiteInquiries.id, input.before.id),
          ),
        )!,
      );
    }
    const rows = await this.database
      .select(reviewSelection)
      .from(websiteInquiries)
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(websiteInquiries.createdAt), desc(websiteInquiries.id))
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    return {
      items: page.map(listItem),
      nextCursor:
        rows.length > input.limit && page.length > 0
          ? cursorFor(page[page.length - 1]!)
          : null,
    };
  }

  async countNew(): Promise<number> {
    const [result] = await this.database
      .select({ value: count() })
      .from(websiteInquiries)
      .where(eq(websiteInquiries.status, "new"));
    return Number(result?.value ?? 0);
  }

  async getDetail(id: string) {
    const [inquiry] = await this.database
      .select(reviewSelection)
      .from(websiteInquiries)
      .where(eq(websiteInquiries.id, id))
      .limit(1);
    if (!inquiry) return null;
    const auditHistory = await this.database
      .select({
        id: auditEntries.id,
        entityType: auditEntries.entityType,
        entityId: auditEntries.entityId,
        action: auditEntries.action,
        before: auditEntries.before,
        after: auditEntries.after,
        reversesEntryId: auditEntries.reversesEntryId,
        createdAt: auditEntries.createdAt,
      })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.entityType, "website_inquiry"),
          eq(auditEntries.entityId, id),
        ),
      )
      .orderBy(desc(auditEntries.createdAt));
    return { inquiry, auditHistory };
  }

  async runStatusTransaction<T>(
    operation: (transaction: WebsiteInquiryStatusTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) =>
      operation({
        getForUpdate: async (id) => {
          const [inquiry] = await transaction
            .select(reviewSelection)
            .from(websiteInquiries)
            .where(eq(websiteInquiries.id, id))
            .limit(1)
            .for("update");
          return inquiry ?? null;
        },
        updateStatus: async (input) => {
          const [updated] = await transaction
            .update(websiteInquiries)
            .set({
              status: input.status,
              reviewedByKind: input.actor.kind,
              reviewedById: input.actor.id,
              reviewedByName: input.actor.name,
              reviewedAt: input.now,
              updatedAt: input.now,
            })
            .where(eq(websiteInquiries.id, input.id))
            .returning(reviewSelection);
          if (!updated) throw new Error("Website inquiry status was not saved.");
          return updated;
        },
        recordAuditEntry: (change) => recordAuditEntry(transaction, change),
      }),
    );
  }
}
