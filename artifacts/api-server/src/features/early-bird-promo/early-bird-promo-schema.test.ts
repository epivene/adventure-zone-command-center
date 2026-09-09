import { describe, expect, it } from "vitest";
import * as dbSchema from "@/db/schema";

describe("Early Bird Promo schema", () => {
  it("exports the durable deadline and reminder lifecycle fields", () => {
    const earlyBirdPromoEnrollments = dbSchema.earlyBirdPromoEnrollments;
    expect(earlyBirdPromoEnrollments.organizationId).toBeDefined();
    expect(earlyBirdPromoEnrollments.eventYear).toBeDefined();
    expect(earlyBirdPromoEnrollments.deadlineDate).toBeDefined();
    expect(earlyBirdPromoEnrollments.expiresAt).toBeDefined();
    expect(earlyBirdPromoEnrollments.reminderDueAt).toBeDefined();
    expect(earlyBirdPromoEnrollments.depositReceivedAt).toBeDefined();
    expect(earlyBirdPromoEnrollments.claimLeaseExpiresAt).toBeDefined();
  });

  it("keeps event context on reviewable Office drafts", () => {
    const { officeEmailDrafts } = dbSchema;
    expect(officeEmailDrafts.bookingId).toBeDefined();
    expect(officeEmailDrafts.eventYear).toBeDefined();
  });
});
