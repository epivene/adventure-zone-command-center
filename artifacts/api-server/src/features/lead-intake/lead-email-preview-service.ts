import { evaluateDraftReadiness, type DraftReadinessInput } from "./draft-readiness-policy";
import { renderLeadEmail } from "./lead-email-renderer";
import type { CommunicationBlock } from "./communication-block-policy";

export type LeadEmailPreviewLead = {
  rowId: string; reviewVersion: number; organizationId?: string | null; contactId?: string | null; profileName: string | null; eventName: string; eventCity: string | null; eventRegion: string | null;
  startDate: string; endDate: string; firstName: string | null; recipientEmail: string; rowState: string; recipientConfirmed: boolean; introductionSuitable: boolean;
  relationshipOutcome: string | null; territoryStatus: string | null; fitStatus: string | null;
};

export function buildLeadEmailPreview(input: { lead: LeadEmailPreviewLead; blocks: readonly CommunicationBlock[]; availability: DraftReadinessInput["availability"]; now?: Date; freshnessMs?: number; calendarEvidence?: unknown[] }) {
  const baseReadiness = evaluateDraftReadiness({
    rowId: input.lead.rowId, organizationId: input.lead.organizationId, contactId: input.lead.contactId,
    recipientEmail: input.lead.recipientEmail, rowState: input.lead.rowState, recipientConfirmed: input.lead.recipientConfirmed,
    introductionSuitable: input.lead.introductionSuitable, relationshipOutcome: input.lead.relationshipOutcome,
    territoryStatus: input.lead.territoryStatus, fitStatus: input.lead.fitStatus, communicationBlocks: input.blocks,
    availability: input.availability, now: input.now, freshnessMs: input.freshnessMs,
  });
  const versionMatches = input.availability?.reviewVersion === input.lead.reviewVersion
    && input.availability?.proposedStartDate === input.lead.startDate
    && input.availability?.proposedEndDate === input.lead.endDate;
  const readiness = versionMatches ? baseReadiness : { ready: false, blockers: [...baseReadiness.blockers, "availability_stale_for_lead_version"] };
  if (!readiness.ready) return { recipient: input.lead.recipientEmail, profileName: input.lead.profileName, eventName: input.lead.eventName, dateRange: { startDate: input.lead.startDate, endDate: input.lead.endDate }, calendarEvidence: input.calendarEvidence ?? [], packageAvailability: input.availability?.packageAvailability ?? null, readiness, subject: null, body: null };
  const rendered = renderLeadEmail({ profileName: input.lead.profileName, eventName: input.lead.eventName, eventCity: input.lead.eventCity, eventRegion: input.lead.eventRegion, startDate: input.lead.startDate, endDate: input.lead.endDate, firstName: input.lead.firstName, packageAvailability: input.availability!.packageAvailability! });
  return { recipient: input.lead.recipientEmail, profileName: input.lead.profileName, eventName: input.lead.eventName, dateRange: { startDate: input.lead.startDate, endDate: input.lead.endDate }, calendarEvidence: input.calendarEvidence ?? [], packageAvailability: input.availability?.packageAvailability ?? null, readiness, ...rendered };
}
