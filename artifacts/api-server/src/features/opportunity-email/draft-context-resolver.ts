import { normalizeSendableContactEmail } from "@/features/contacts/contact-email-value";

export type DraftRecipientSource = "profile" | "gmail" | "act" | "other";

export type DraftRecipientCandidate = {
  contactId: string | null;
  email: string | null;
  name: string | null;
  verifiedAt: Date | null;
  source: DraftRecipientSource;
};

export type DraftContext = {
  opportunityId: string;
  organizationId: string;
  eventYear: number;
  eventName: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  contactId: string | null;
  recipientEmail: string | null;
  recipientName: string | null;
  recipientAmbiguous: boolean;
  priorRelationshipSummary: string[];
  sameYearSentCount: number;
  sameYearDeclined: boolean;
  existingDraftId: string | null;
  calendarEvidence: unknown[];
  packageAvailability: unknown;
  protectedRecord: boolean;
  territoryExceptionApproved: boolean;
};

type OpportunityContextRecord = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: string;
};

type ProfileDraftContext = {
  eventName: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
  protectedRecord: boolean;
  territoryExceptionApproved: boolean;
};

export type DraftContextSources = {
  getOpportunity(opportunityId: string): Promise<OpportunityContextRecord | null>;
  getProfileContext(organizationId: string, eventYear: number): Promise<ProfileDraftContext>;
  listRecipientCandidates(organizationId: string, eventYear: number): Promise<DraftRecipientCandidate[]>;
  listRelationshipSummary(organizationId: string, eventYear: number, recipientEmail: string): Promise<string[]>;
  countSameYearSent(opportunityId: string): Promise<number>;
  hasSameYearDecline(opportunityId: string): Promise<boolean>;
  getCurrentDraftId(opportunityId: string): Promise<string | null>;
  getCalendarEvidence(opportunityId: string): Promise<unknown[]>;
  getPackageAvailability(opportunityId: string): Promise<unknown>;
};

function chooseRecipient(candidates: DraftRecipientCandidate[]): {
  candidate: DraftRecipientCandidate | null;
  ambiguous: boolean;
} {
  const usable = candidates
    .map((candidate) => ({
      ...candidate,
      email: normalizeSendableContactEmail(candidate.email),
    }))
    .filter((candidate): candidate is DraftRecipientCandidate & { email: string } => Boolean(candidate.email))
    .sort((left, right) => {
      const leftTime = left.verifiedAt?.getTime() ?? 0;
      const rightTime = right.verifiedAt?.getTime() ?? 0;
      return rightTime - leftTime;
    });

  const first = usable[0];
  if (!first) return { candidate: null, ambiguous: false };

  const firstTime = first.verifiedAt?.getTime() ?? 0;
  const tied = usable.filter((candidate) => (candidate.verifiedAt?.getTime() ?? 0) === firstTime);
  const distinctEmails = new Set(tied.map((candidate) => candidate.email));
  if (distinctEmails.size > 1) return { candidate: null, ambiguous: true };

  return { candidate: first, ambiguous: false };
}

export class DraftContextResolver {
  constructor(private readonly sources: DraftContextSources) {}

  async resolve(opportunityId: string): Promise<DraftContext> {
    const opportunity = await this.sources.getOpportunity(opportunityId);
    if (!opportunity) throw new Error(`Booking opportunity not found: ${opportunityId}`);

    const [
      profile,
      recipients,
      sameYearSentCount,
      sameYearDeclined,
      existingDraftId,
      calendarEvidence,
      packageAvailability,
    ] = await Promise.all([
      this.sources.getProfileContext(opportunity.organizationId, opportunity.eventYear),
      this.sources.listRecipientCandidates(opportunity.organizationId, opportunity.eventYear),
      this.sources.countSameYearSent(opportunity.id),
      this.sources.hasSameYearDecline(opportunity.id),
      this.sources.getCurrentDraftId(opportunity.id),
      this.sources.getCalendarEvidence(opportunity.id),
      this.sources.getPackageAvailability(opportunity.id),
    ]);

    const recipient = chooseRecipient(recipients);
    const priorRelationshipSummary = recipient.candidate?.email && !recipient.ambiguous
      ? await this.sources.listRelationshipSummary(
          opportunity.organizationId,
          opportunity.eventYear,
          recipient.candidate.email,
        )
      : [];

    return {
      opportunityId: opportunity.id,
      organizationId: opportunity.organizationId,
      eventYear: opportunity.eventYear,
      eventName: profile.eventName,
      city: profile.city,
      region: profile.region,
      startsAt: profile.startsAt,
      endsAt: profile.endsAt,
      contactId: recipient.candidate?.contactId ?? null,
      recipientEmail: recipient.candidate?.email ?? null,
      recipientName: recipient.candidate?.name ?? null,
      recipientAmbiguous: recipient.ambiguous,
      priorRelationshipSummary: [...priorRelationshipSummary],
      sameYearSentCount,
      sameYearDeclined,
      existingDraftId,
      calendarEvidence: [...calendarEvidence],
      packageAvailability,
      protectedRecord: profile.protectedRecord,
      territoryExceptionApproved: profile.territoryExceptionApproved,
    };
  }
}
