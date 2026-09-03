import { and, desc, eq, gte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { websiteInquiries } from "@/db/schema";
import type {
  NewWebsiteInquiry,
  WebsiteInquiryIntakeRepository,
  WebsiteInquiryReceipt,
} from "./website-inquiry-service";

const receiptSelection = {
  inquiryId: websiteInquiries.id,
  referenceCode: websiteInquiries.referenceCode,
  createdAt: websiteInquiries.createdAt,
};

export class DrizzleWebsiteInquiryRepository
  implements WebsiteInquiryIntakeRepository
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
}
