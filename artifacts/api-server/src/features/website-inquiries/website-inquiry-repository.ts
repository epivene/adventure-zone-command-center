import { and, asc, desc, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { websiteInquiries } from "@/db/schema";
import type {
  NewWebsiteInquiry,
  WebsiteInquiryIntakeRepository,
  WebsiteInquiryReceipt,
} from "./website-inquiry-service";
import type {
  WebsiteInquiryAlertClaim,
  WebsiteInquiryAlertRepository,
} from "./website-inquiry-alert-worker";

const receiptSelection = {
  inquiryId: websiteInquiries.id,
  referenceCode: websiteInquiries.referenceCode,
  createdAt: websiteInquiries.createdAt,
};

export class DrizzleWebsiteInquiryRepository
  implements WebsiteInquiryIntakeRepository, WebsiteInquiryAlertRepository
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
}
