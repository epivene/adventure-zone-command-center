import {
  EARLY_BIRD_PROMO,
  earlyBirdPromoDates,
  earlyBirdPromoEligibility,
  removeEarlyBirdPromoBlock,
  upsertEarlyBirdPromoBlock,
} from "@/features/early-bird-promo/early-bird-promo-policy";
import type { RenderedCommunicationTemplate } from "./communication-template-types";

export type EarlyBirdPromotionTarget = {
  category: string | null;
  code: string | null;
  now: Date;
  alreadyPaid: boolean;
  existingPromotionDeadlineDate?: string | null;
  bookingId: string | null;
  eventYear: number;
};

export function applyEarlyBirdPromoToRenderedTemplate(
  rendered: Omit<RenderedCommunicationTemplate, "promotion">,
  target: EarlyBirdPromotionTarget,
): RenderedCommunicationTemplate {
  const eligible = earlyBirdPromoEligibility({
    sentAt: target.now,
    category: target.category,
    code: target.code,
    alreadyPaid: target.alreadyPaid,
  });
  if (!eligible) {
    return {
      ...rendered,
      body: removeEarlyBirdPromoBlock(rendered.body),
      promotion: null,
    };
  }

  const deadlineDate = target.existingPromotionDeadlineDate
    ?? earlyBirdPromoDates(target.now).deadlineDate;
  return {
    ...rendered,
    body: upsertEarlyBirdPromoBlock(rendered.body, deadlineDate),
    promotion: {
      name: EARLY_BIRD_PROMO.name,
      provisionalDeadlineDate: deadlineDate,
      eligible: true,
      bookingId: target.bookingId,
      eventYear: target.eventYear,
    },
  };
}
