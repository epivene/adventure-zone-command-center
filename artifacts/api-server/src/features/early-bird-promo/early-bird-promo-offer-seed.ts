import type { db as database } from "@/db/client";
import { commercialOfferRules } from "@/db/schema";
import { EARLY_BIRD_PROMO } from "./early-bird-promo-policy";

type Database = typeof database;

const approvedAt = new Date("2026-09-09T00:00:00.000Z");

const approvedOffer = {
  code: EARLY_BIRD_PROMO.offerCode,
  name: "Early Bird Promo — 10%",
  kind: "discount" as const,
  state: "active" as const,
  audience: "customer_safe" as const,
  sourceDocumentId: null,
  calculationType: "percent_basis_points" as const,
  amountCents: null,
  amountBasisPoints: 1000,
  calculationScope: "eligible booking subtotal",
  stackPolicy: "manual" as const,
  appliesToPackageCodes: [] as string[],
  repeatCustomerOnly: false,
  newCustomerOnly: false,
  requiresOwnerConfirmation: false,
  deadlineMode: "days_after_trigger" as const,
  deadlineDays: EARLY_BIRD_PROMO.deadlineDays,
  fixedDeadline: null,
  customerSummary:
    "For a limited time, The Adventure Zone is offering 10% off bookings when deposits are received by the displayed promotion deadline.",
  internalConditions:
    "Approved Early Bird Promo for qualifying sales emails sent through March 31, 2027. The first confirmed send sets one 30-day event deadline. Do not reset or stack automatically.",
  sourceConflictNote: null,
  reviewedBy: "conversation:2026-09-09",
  reviewedAt: approvedAt,
};

export async function ensureEarlyBirdPromoOffer(
  database: Database,
): Promise<void> {
  await database
    .insert(commercialOfferRules)
    .values(approvedOffer)
    .onConflictDoUpdate({
      target: commercialOfferRules.code,
      set: {
        ...approvedOffer,
        updatedAt: approvedAt,
      },
    });
}
