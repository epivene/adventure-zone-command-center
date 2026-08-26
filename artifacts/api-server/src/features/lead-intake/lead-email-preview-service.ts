import { evaluateDraftReadiness, type DraftReadinessInput } from "./draft-readiness-policy";
import { renderLeadEmail } from "./lead-email-renderer";
import type { CommunicationBlock } from "./communication-block-policy";
import { approvedNormalPackageForKey } from "./lead-package-allowlist";

export type LeadEmailPreviewDto = { sourceRowId: string; rowVersion: number; snapshotVersion: number | null; verifiedDateRange: { startDate: string; endDate: string }; recipient: string; profileName: string | null; eventName: string; relationshipStatus: string | null; territoryStatus: string | null; fitStatus: string | null; templateStatus: "approved" | "unavailable"; calendarEvidence: Array<{ calendarId: string | null; eventId: string | null; conflict: boolean }>; normalPackageCounts: Array<{ packageKey: string; availableQuantity: number }>; readiness: { ready: boolean; blockers: string[] }; subject: string | null; body: string | null };

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
  const calendarEvidence = (input.calendarEvidence ?? []).slice(0, 20).map((value: any) => ({ calendarId: typeof value?.calendarId === "string" ? value.calendarId : null, eventId: typeof value?.eventId === "string" ? value.eventId : null, conflict: value?.classification?.confidence === "ambiguous" }));
  const normalPackageCounts = (input.availability?.packageAvailability?.packages ?? []).filter((item) => isFinite(item.availableQuantity) && approvedNormalPackageForKey(item.packageKey)).map((item) => ({ packageKey: item.packageKey, availableQuantity: item.availableQuantity }));
  const dto = { sourceRowId: input.lead.rowId, rowVersion: input.lead.reviewVersion, snapshotVersion: input.availability?.reviewVersion ?? null, verifiedDateRange: { startDate: input.lead.startDate, endDate: input.lead.endDate }, recipient: input.lead.recipientEmail, profileName: input.lead.profileName, eventName: input.lead.eventName, relationshipStatus: input.lead.relationshipOutcome, territoryStatus: input.lead.territoryStatus, fitStatus: input.lead.fitStatus, templateStatus: "approved" as const, calendarEvidence, normalPackageCounts, readiness };
  if (!readiness.ready) return { ...dto, subject: null, body: null } as LeadEmailPreviewDto;
  const rendered = renderLeadEmail({ profileName: input.lead.profileName, eventName: input.lead.eventName, eventCity: input.lead.eventCity, eventRegion: input.lead.eventRegion, startDate: input.lead.startDate, endDate: input.lead.endDate, firstName: input.lead.firstName, packageAvailability: input.availability!.packageAvailability! });
  return { ...dto, ...rendered } as LeadEmailPreviewDto;
}
