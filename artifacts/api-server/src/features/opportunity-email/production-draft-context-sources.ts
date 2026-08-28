import type {
  DraftContextSources,
  DraftRecipientCandidate,
} from "./draft-context-resolver";

type OpportunityContext = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: string;
  emailAutomationProtected: boolean;
  territoryExceptionApproved: boolean;
};

type ProfileContext = {
  eventName: string;
  city: string | null;
  region: string | null;
  startsAt: Date | null;
  endsAt: Date | null;
};

type RelationshipEvidence = {
  sourceType: string;
  direction: string;
  occurredAt: Date;
  excerpt: string;
};

type AvailabilityEvidence = {
  calendarEvidence: unknown[];
  packageAvailability: unknown;
};

type Dependencies = {
  opportunities: {
    get(id: string): Promise<OpportunityContext | null>;
    getForOrganizationYear?(
      organizationId: string,
      eventYear: number,
    ): Promise<OpportunityContext | null>;
  };
  profiles: {
    get(
      organizationId: string,
      eventYear: number,
      bookingId: string | null,
    ): Promise<ProfileContext>;
  };
  recipients: {
    list(
      organizationId: string,
      eventYear: number,
    ): Promise<DraftRecipientCandidate[]>;
  };
  relationships: {
    list(input: {
      organizationId: string;
      recipientEmail: string;
    }): Promise<RelationshipEvidence[]>;
  };
  emailState: {
    countSent(opportunityId: string): Promise<number>;
    currentDraftId(opportunityId: string): Promise<string | null>;
  };
  availability: {
    resolve(opportunity: OpportunityContext): Promise<AvailabilityEvidence>;
  };
};

function dateLabel(value: Date): string {
  return Number.isFinite(value.getTime()) ? value.toISOString().slice(0, 10) : "unknown date";
}

function sourceLabel(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === "gmail") return "Gmail";
  if (normalized === "act") return "ACT";
  return value.trim() || "History";
}

export class ProductionDraftContextSources implements DraftContextSources {
  private readonly availabilityByOpportunity = new Map<string, Promise<AvailabilityEvidence>>();

  constructor(private readonly deps: Dependencies) {}

  getOpportunity(opportunityId: string) {
    return this.deps.opportunities.get(opportunityId);
  }

  async getProfileContext(organizationId: string, eventYear: number) {
    const opportunity = this.deps.opportunities.getForOrganizationYear
      ? await this.deps.opportunities.getForOrganizationYear(organizationId, eventYear)
      : await this.deps.opportunities.get(organizationId);
    if (!opportunity) throw new Error("BOOKING_OPPORTUNITY_NOT_FOUND");
    const profile = await this.deps.profiles.get(
      organizationId,
      eventYear,
      opportunity.bookingId,
    );
    return {
      ...profile,
      protectedRecord: opportunity.emailAutomationProtected,
      territoryExceptionApproved: opportunity.territoryExceptionApproved,
    };
  }

  listRecipientCandidates(organizationId: string, eventYear: number) {
    return this.deps.recipients.list(organizationId, eventYear);
  }

  async listRelationshipSummary(
    organizationId: string,
    _eventYear: number,
    recipientEmail: string,
  ): Promise<string[]> {
    const evidence = await this.deps.relationships.list({
      organizationId,
      recipientEmail,
    });
    return evidence
      .filter((item) => Number.isFinite(item.occurredAt.getTime()))
      .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime())
      .map((item) => {
        const excerpt = item.excerpt.trim();
        const prefix = `${sourceLabel(item.sourceType)} ${item.direction} ${dateLabel(item.occurredAt)}`;
        return excerpt ? `${prefix}: ${excerpt}` : prefix;
      });
  }

  countSameYearSent(opportunityId: string) {
    return this.deps.emailState.countSent(opportunityId);
  }

  async hasSameYearDecline(opportunityId: string): Promise<boolean> {
    const opportunity = await this.requireOpportunity(opportunityId);
    return opportunity.status === "declined" || opportunity.status === "not_pursuing";
  }

  getCurrentDraftId(opportunityId: string) {
    return this.deps.emailState.currentDraftId(opportunityId);
  }

  async getCalendarEvidence(opportunityId: string): Promise<unknown[]> {
    const result = await this.availabilityFor(opportunityId);
    return [...result.calendarEvidence];
  }

  async getPackageAvailability(opportunityId: string): Promise<unknown> {
    const result = await this.availabilityFor(opportunityId);
    return result.packageAvailability;
  }

  private availabilityFor(opportunityId: string): Promise<AvailabilityEvidence> {
    const current = this.availabilityByOpportunity.get(opportunityId);
    if (current) return current;
    const pending = this.requireOpportunity(opportunityId)
      .then((opportunity) => this.deps.availability.resolve(opportunity))
      .catch((error) => {
        this.availabilityByOpportunity.delete(opportunityId);
        throw error;
      });
    this.availabilityByOpportunity.set(opportunityId, pending);
    return pending;
  }

  private async requireOpportunity(opportunityId: string): Promise<OpportunityContext> {
    const opportunity = await this.deps.opportunities.get(opportunityId);
    if (!opportunity) throw new Error("BOOKING_OPPORTUNITY_NOT_FOUND");
    return opportunity;
  }
}
