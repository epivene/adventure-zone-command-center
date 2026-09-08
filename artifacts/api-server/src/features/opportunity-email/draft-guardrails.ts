import type { OpportunityDraftPurpose } from "./opportunity-email-types";
import type { DraftContext } from "./draft-context-resolver";

export type { DraftContext } from "./draft-context-resolver";

export type DraftBlockerCode =
  | "missing_recipient"
  | "ambiguous_recipient"
  | "duplicate_outreach"
  | "current_year_decline"
  | "territory_hold"
  | "protected_record"
  | "availability_unknown"
  | "relationship_ambiguity"
  | "needs_review";

export type DraftBlocker = {
  code: DraftBlockerCode;
  message: string;
  requiresHumanReview: true;
};

export const ADVENTURE_ZONE_EMAIL_RULES = {
  inventory: {
    adventureZone: 5,
    piratesRebellion: 3,
    warriorsPlayground: 1,
    restrictedPirateExcluded: true,
  },
  pricing: {
    adventureZone: "$9,000 / 1–4 days",
    piratesRebellion: "$8,000 / 1–4 days",
    warriorsPlayground: "$8,000 / 1–4 days (ammo extra)",
  },
  insurance: "$2M",
  payForPlay:
    "In some instances, we may also be able to come at no up-front charge, charge the public to play, and pay your event a percentage of our ticket box sales.",
  forbiddenClaims: [
    "revenue guarantee",
    "attendance guarantee",
    "minimum-sales promise",
    "guarantee language",
    "no guarantee",
    "offer to purchase sponsorship",
  ],
  preferredPartnershipTerms: [
    "entertainment partnership",
    "event partnership",
    "separate staffed attraction area",
    "family-entertainment area",
  ],
  adultOnlyIsAutomaticRejection: false,
} as const;

const TERRITORY_HOLD_REGIONS = new Set(["NM", "OR", "CA", "KS", "OK", "TX"]);

function blocker(code: DraftBlockerCode, message: string): DraftBlocker {
  return { code, message, requiresHumanReview: true };
}

function availabilityResolved(value: unknown): boolean {
  if (value == null) return false;
  if (typeof value !== "object") return true;
  const status = (value as { status?: unknown }).status;
  return status !== "unresolved";
}

export function evaluateDraftGuardrails(
  context: DraftContext,
  purpose: OpportunityDraftPurpose,
): { blocker: DraftBlocker | null; effectivePurpose: OpportunityDraftPurpose } {
  if (context.recipientAmbiguous) {
    return {
      blocker: blocker("ambiguous_recipient", "More than one equally current recipient is available. Choose the correct contact before drafting."),
      effectivePurpose: purpose,
    };
  }
  if (!context.recipientEmail) {
    return {
      blocker: blocker("missing_recipient", "No verified recipient email is available for this opportunity."),
      effectivePurpose: purpose,
    };
  }
  if (context.protectedRecord) {
    return {
      blocker: blocker("protected_record", "This record is protected and requires human authorization before drafting or sending."),
      effectivePurpose: purpose,
    };
  }
  if (context.sameYearDeclined) {
    return {
      blocker: blocker("current_year_decline", "This opportunity has a current-year decline or not-pursuing outcome and requires review before new outreach."),
      effectivePurpose: purpose,
    };
  }

  const region = context.region?.trim().toUpperCase() ?? "";
  if (
    purpose === "new_outreach" &&
    TERRITORY_HOLD_REGIONS.has(region) &&
    !context.territoryExceptionApproved
  ) {
    return {
      blocker: blocker("territory_hold", `Routine new outreach in ${region} requires a human-approved territory exception.`),
      effectivePurpose: purpose,
    };
  }

  if (!availabilityResolved(context.packageAvailability) || context.calendarEvidence.length === 0) {
    return {
      blocker: blocker("availability_unknown", "Current package/calendar availability has not been established."),
      effectivePurpose: purpose,
    };
  }

  const effectivePurpose = purpose === "new_outreach" && context.sameYearSentCount > 0
    ? "follow_up"
    : purpose;

  return { blocker: null, effectivePurpose };
}
