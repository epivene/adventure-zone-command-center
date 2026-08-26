import type { ApprovedLeadIntroductionDefinition } from "../communication-templates/lead-introduction-2026-approved";
import type { CommunicationBlock } from "./communication-block-policy";
import { proposedBookingWindow } from "./calendar-window";
import { evaluateDraftReadiness, type DraftReadinessInput } from "./draft-readiness-policy";
import { renderLeadEmail } from "./lead-email-renderer";
import { approvedNormalPackageForKey } from "./lead-package-allowlist";
import type { LeadEmailPreviewRepository } from "./lead-email-preview-repository";

export type LeadEmailPreviewTemplate = {
  templateId: string;
  code: string;
  version: string;
  sourceDocumentId: string;
  sourceFilename: string;
  reviewedBy: string;
  reviewedAt: string;
  definition: ApprovedLeadIntroductionDefinition;
};

export type LeadEmailPreviewDto = {
  sourceRowId: string;
  rowVersion: number;
  snapshotVersion: number | null;
  verifiedDateRange: { startDate: string; endDate: string };
  recipient: string;
  profileName: string | null;
  eventName: string;
  relationshipStatus: string | null;
  territoryStatus: string | null;
  fitStatus: string | null;
  templateStatus: "approved" | "unavailable";
  templateVersion: string | null;
  templateSource: string | null;
  calendarEvidence: Array<{ calendarId: string | null; eventId: string | null; conflict: boolean }>;
  calendarConflictSummary: {
    totalConflicts: number;
    totalEvidenceRecords: number;
    displayedEvidenceRecords: number;
    truncated: boolean;
  };
  normalPackageCounts: Array<{ packageKey: string; availableQuantity: number }>;
  readiness: { ready: boolean; blockers: string[] };
  subject: string | null;
  body: string | null;
};

export type LeadEmailPreviewLead = {
  rowId: string;
  reviewVersion: number;
  organizationId?: string | null;
  contactId?: string | null;
  profileName: string | null;
  eventName: string;
  eventCity: string | null;
  eventRegion: string | null;
  startDate: string;
  endDate: string;
  firstName: string | null;
  recipientEmail: string;
  rowState: string;
  recipientConfirmed: boolean;
  introductionSuitable: boolean;
  relationshipOutcome: string | null;
  territoryStatus: string | null;
  fitStatus: string | null;
};

type PreviewAvailability = (DraftReadinessInput["availability"] & {
  reviewVersion: number;
  proposedStartDate: string;
  proposedEndDate: string;
}) | null;

function uniqueBlockers(...groups: readonly (readonly string[])[]): string[] {
  return [...new Set(groups.flat())];
}

export function buildLeadEmailPreview(input: {
  lead: LeadEmailPreviewLead;
  blocks: readonly CommunicationBlock[];
  availability: PreviewAvailability;
  approvedTemplate: LeadEmailPreviewTemplate | null;
  now?: Date;
  freshnessMs?: number;
  calendarEvidence?: unknown[];
  calendarReservations?: unknown[];
}): LeadEmailPreviewDto {
  const baseReadiness = evaluateDraftReadiness({
    rowId: input.lead.rowId,
    organizationId: input.lead.organizationId,
    contactId: input.lead.contactId,
    recipientEmail: input.lead.recipientEmail,
    rowState: input.lead.rowState,
    recipientConfirmed: input.lead.recipientConfirmed,
    introductionSuitable: input.lead.introductionSuitable,
    relationshipOutcome: input.lead.relationshipOutcome,
    territoryStatus: input.lead.territoryStatus,
    fitStatus: input.lead.fitStatus,
    communicationBlocks: input.blocks,
    availability: input.availability,
    now: input.now,
    freshnessMs: input.freshnessMs,
  });
  const expectedWindow = proposedBookingWindow({
    startDate: input.lead.startDate,
    endDate: input.lead.endDate,
  });
  const snapshotMatches = !input.availability || (
    input.availability.reviewVersion === input.lead.reviewVersion
    && input.availability.proposedStartDate === expectedWindow.startDate
    && input.availability.proposedEndDate === expectedWindow.endDate
  );
  const safetyBlockers = [
    ...(snapshotMatches ? [] : ["availability_stale_for_lead_version"]),
    ...(input.approvedTemplate ? [] : ["template_not_approved"]),
  ];
  const blockers = uniqueBlockers(baseReadiness.blockers, safetyBlockers);
  const readiness = { ready: baseReadiness.ready && safetyBlockers.length === 0, blockers };
  const allCalendarEvidence = input.calendarEvidence ?? [];
  const calendarEvidence = allCalendarEvidence.slice(0, 20).map((value: any) => ({
    calendarId: typeof value?.calendarId === "string" ? value.calendarId : null,
    eventId: typeof value?.eventId === "string" ? value.eventId : null,
    conflict: value?.classification?.confidence === "ambiguous" || value?.conflict === true,
  }));
  const totalConflicts = (input.calendarReservations ?? []).filter(
    (value: any) => value?.confidence === "ambiguous",
  ).length;
  const calendarConflictSummary = {
    totalConflicts,
    totalEvidenceRecords: allCalendarEvidence.length,
    displayedEvidenceRecords: calendarEvidence.length,
    truncated: allCalendarEvidence.length > calendarEvidence.length,
  };
  const normalPackageCounts = (input.availability?.packageAvailability?.packages ?? [])
    .filter((item) => isFinite(item.availableQuantity) && approvedNormalPackageForKey(item.packageKey))
    .map((item) => ({ packageKey: item.packageKey, availableQuantity: item.availableQuantity }));
  const dto = {
    sourceRowId: input.lead.rowId,
    rowVersion: input.lead.reviewVersion,
    snapshotVersion: input.availability?.reviewVersion ?? null,
    verifiedDateRange: { startDate: input.lead.startDate, endDate: input.lead.endDate },
    recipient: input.lead.recipientEmail,
    profileName: input.lead.profileName,
    eventName: input.lead.eventName,
    relationshipStatus: input.lead.relationshipOutcome,
    territoryStatus: input.lead.territoryStatus,
    fitStatus: input.lead.fitStatus,
    templateStatus: input.approvedTemplate ? "approved" as const : "unavailable" as const,
    templateVersion: input.approvedTemplate?.version ?? null,
    templateSource: input.approvedTemplate?.sourceFilename ?? null,
    calendarEvidence,
    calendarConflictSummary,
    normalPackageCounts,
    readiness,
  };
  if (!readiness.ready || !input.approvedTemplate) return { ...dto, subject: null, body: null };
  const rendered = renderLeadEmail({
    profileName: input.lead.profileName,
    eventName: input.lead.eventName,
    eventCity: input.lead.eventCity,
    eventRegion: input.lead.eventRegion,
    startDate: input.lead.startDate,
    endDate: input.lead.endDate,
    firstName: input.lead.firstName,
    packageAvailability: input.availability!.packageAvailability!,
  }, input.approvedTemplate.definition);
  return { ...dto, ...rendered };
}

export class LeadEmailPreviewService {
  constructor(
    private readonly repository: Pick<LeadEmailPreviewRepository, "load">,
  ) {}

  async preview(rowId: string, expectedVersion: number): Promise<LeadEmailPreviewDto> {
    const state = await this.repository.load(rowId, expectedVersion);
    return buildLeadEmailPreview(state);
  }
}
