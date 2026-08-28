import type { OpportunityEmailRecord } from "./opportunity-email-types";
import type { ReadyToSendSource, ReadyToSendSourceRow } from "./ready-to-send-service";

type Opportunity = {
  id: string;
  organizationId: string;
  eventYear: number;
  bookingId: string | null;
  contactId: string | null;
  status: string;
  emailAutomationProtected: boolean;
  territoryExceptionApproved: boolean;
};

type Dependencies = {
  emails: {
    listReadyToSend(): Promise<OpportunityEmailRecord[]>;
    getById(id: string): Promise<OpportunityEmailRecord | null>;
  };
  opportunities: { get(id: string): Promise<Opportunity | null> };
  profiles: { name(organizationId: string, eventYear: number, bookingId: string | null): Promise<string> };
};

const blockedStatuses = new Set(["needs_review", "declined", "not_pursuing", "territory_hold", "cancelled"]);

function warningFor(opportunity: Opportunity, draft: OpportunityEmailRecord): string | null {
  if (opportunity.emailAutomationProtected) return "This Opportunity is protected and requires human review before email delivery.";
  if (blockedStatuses.has(opportunity.status)) return `Opportunity status ${opportunity.status.replaceAll("_", " ")} blocks bulk email delivery.`;
  return draft.lastFailureMessage;
}

export class ProductionReadyToSendSource implements ReadyToSendSource {
  constructor(private readonly deps: Dependencies) {}

  async list(): Promise<ReadyToSendSourceRow[]> {
    const drafts = await this.deps.emails.listReadyToSend();
    const rows = await Promise.all(drafts.map((draft) => this.project(draft)));
    return rows.filter((row): row is ReadyToSendSourceRow => row !== null);
  }

  async get(draftId: string): Promise<ReadyToSendSourceRow | null> {
    const draft = await this.deps.emails.getById(draftId);
    return draft ? this.project(draft) : null;
  }

  private async project(draft: OpportunityEmailRecord): Promise<ReadyToSendSourceRow | null> {
    const opportunity = await this.deps.opportunities.get(draft.opportunityId);
    if (!opportunity) return null;
    const eventName = await this.deps.profiles.name(
      opportunity.organizationId,
      opportunity.eventYear,
      opportunity.bookingId,
    );
    const warning = warningFor(opportunity, draft);
    return {
      draft,
      eventName,
      opportunityStatus: opportunity.status,
      ownerVisible: true,
      blocked: Boolean(warning && (opportunity.emailAutomationProtected || blockedStatuses.has(opportunity.status))),
      warning,
    };
  }
}
