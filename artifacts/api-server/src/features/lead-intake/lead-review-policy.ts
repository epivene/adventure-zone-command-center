export const leadEvidenceSourceKinds = [
  "crm_contact",
  "act_description",
  "official_website",
  "manual",
] as const;

export type LeadEvidenceSourceKind = (typeof leadEvidenceSourceKinds)[number];

export type LeadReviewDecision = {
  organizationId: string | null;
  contactMode: "existing" | "manual";
  contactId: string | null;
  contactBelongsToOrganization?: boolean;
  contactEmailMatchesRecipient?: boolean;
  contactName: string;
  contactRole: string;
  recipientEmail: string;
  recipientConfirmed: boolean;
  recipientConflictResolved: boolean;
  introductionSuitable: boolean;
  eventName: string;
  startDate: string;
  endDate: string;
  emailEvidence: { sourceKind: LeadEvidenceSourceKind; sourceReference: string };
  dateEvidence: { sourceKind: LeadEvidenceSourceKind; sourceReference: string };
  candidateEmails?: string[];
};

export type LeadReviewBlocker =
  | "profile_required"
  | "event_name_required"
  | "event_dates_required"
  | "event_date_range_invalid"
  | "event_year_not_2026"
  | "event_outside_september_october"
  | "contact_required"
  | "contact_profile_mismatch"
  | "contact_role_required"
  | "recipient_email_invalid"
  | "recipient_contact_mismatch"
  | "recipient_confirmation_required"
  | "recipient_conflict_unresolved"
  | "introduction_suitability_required"
  | "email_evidence_required"
  | "date_evidence_required";

function text(value: string | null | undefined) {
  return value?.trim() ?? "";
}

function validDateOnly(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function normalizedEmail(value: string) {
  return value.trim().toLowerCase();
}

export function evaluateLeadReview(decision: LeadReviewDecision): {
  verified: boolean;
  blockers: LeadReviewBlocker[];
} {
  const blockers: LeadReviewBlocker[] = [];
  if (!text(decision.organizationId)) blockers.push("profile_required");
  if (!text(decision.eventName)) blockers.push("event_name_required");

  const startValid = validDateOnly(decision.startDate);
  const endValid = validDateOnly(decision.endDate);
  if (!startValid || !endValid) blockers.push("event_dates_required");
  else {
    if (decision.endDate < decision.startDate) blockers.push("event_date_range_invalid");
    if (!decision.startDate.startsWith("2026-") || !decision.endDate.startsWith("2026-")) {
      blockers.push("event_year_not_2026");
    } else if (decision.startDate < "2026-09-01" || decision.endDate > "2026-10-31") {
      blockers.push("event_outside_september_october");
    }
  }

  if (decision.contactMode === "existing") {
    if (!text(decision.contactId)) blockers.push("contact_required");
    else if (decision.contactBelongsToOrganization !== true) blockers.push("contact_profile_mismatch");
    else if (decision.contactEmailMatchesRecipient !== true) blockers.push("recipient_contact_mismatch");
  } else if (!text(decision.contactName)) {
    blockers.push("contact_required");
  }
  if (!text(decision.contactRole)) blockers.push("contact_role_required");

  const recipient = normalizedEmail(decision.recipientEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) blockers.push("recipient_email_invalid");
  if (!decision.recipientConfirmed) blockers.push("recipient_confirmation_required");
  const candidates = [...new Set((decision.candidateEmails ?? []).map(normalizedEmail).filter(Boolean))];
  if (candidates.length > 1 && !candidates.includes(recipient) && !decision.recipientConflictResolved) {
    blockers.push("recipient_conflict_unresolved");
  }
  if (!decision.introductionSuitable) blockers.push("introduction_suitability_required");
  if (!text(decision.emailEvidence.sourceReference)) blockers.push("email_evidence_required");
  if (!text(decision.dateEvidence.sourceReference)) blockers.push("date_evidence_required");

  return { verified: blockers.length === 0, blockers };
}
