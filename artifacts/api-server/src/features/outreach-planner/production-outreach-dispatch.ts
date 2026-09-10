import type { db as runtimeDb } from "@workspace/db";
import { EarlyBirdPromoRepository } from "../early-bird-promo/early-bird-promo-repository";
import { EarlyBirdPromoService } from "../early-bird-promo/early-bird-promo-service";
import { createProductionOutreachAllocation } from "./production-outreach-allocation";
import { OutreachDispatch } from "./outreach-dispatch";
export function createProductionOutreachDispatch(db: typeof runtimeDb) {
  return new OutreachDispatch(
    db,
    createProductionOutreachAllocation(db),
    async (d) => {
      if (!d.eventYear) return d.content.body;
      const prepared = await new EarlyBirdPromoService(
        new EarlyBirdPromoRepository(db),
      ).prepareBody({
        sourceKind: d.kind,
        emailRecordId: d.id,
        opportunityId: d.opportunityId,
        organizationId: d.organizationId,
        bookingId: d.bookingId,
        contactId: d.contactId,
        officeAccountId: d.officeAccountId,
        eventYear: d.eventYear,
        templateCategory: d.templateCategory,
        templateCode: d.templateCode,
        body: d.content.body,
        attemptedAt: new Date(),
      });
      return prepared.body;
    },
  );
}
