import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { db as database } from "@/db/client";
import {
  businessSourceDocuments,
  communicationTemplates,
  leadAvailabilitySnapshots,
  leadImportRows,
  organizations,
} from "@/db/schema";

import {
  APPROVED_LEAD_INTRODUCTION_2026,
  isExactApprovedLeadIntroductionTemplate,
  type ApprovedLeadIntroductionDefinition,
} from "../communication-templates/lead-introduction-2026-approved";
import { CommunicationBlockRepository } from "./communication-block-repository";
import {
  acquireCommunicationSafetyLock,
  type CommunicationSafetyLockExecutor,
} from "./communication-safety-lock";
import type { LeadEmailPreviewLead, LeadEmailPreviewTemplate } from "./lead-email-preview-service";

type Database = typeof database;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export type LeadEmailPreviewRepositoryResult = {
  lead: LeadEmailPreviewLead;
  availability: {
    ready: boolean;
    checkedAt: string;
    reviewVersion: number;
    proposedStartDate: string;
    proposedEndDate: string;
    packageAvailability: any;
  } | null;
  calendarEvidence: unknown[];
  calendarReservations: unknown[];
  blocks: Awaited<ReturnType<CommunicationBlockRepository["listActive"]>>;
  approvedTemplate: LeadEmailPreviewTemplate | null;
};

export class LeadEmailPreviewRepositoryError extends Error {
  constructor(
    readonly code: "ROW_NOT_FOUND" | "ROW_NOT_READY" | "VERSION_CONFLICT",
    message: string,
    readonly details: { expectedVersion?: number; currentVersion?: number } = {},
  ) {
    super(message);
    this.name = "LeadEmailPreviewRepositoryError";
  }
}

type TemplateCandidate = {
  code: string;
  templateVersion: string | null;
  name: string;
  state: string;
  ownerKind: string;
  createdByKind: string;
  accessScope: string;
  channel: string;
  category: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  allowedPlaceholders: string[];
  requiredPlaceholders: string[];
  sourceNote: string | null;
  sourceFilename: string | null;
  sourceDisplayTitle: string | null;
  sourceCategory: string | null;
  sourceEffectiveYear: number | null;
  sourceAccessScope: string | null;
  sourceReviewState: string | null;
  sourceNotes: string | null;
  sourceStorageReference: string | null;
  sourceReviewedBy: string | null;
  sourceReviewedAt: Date | null;
  sourceDocumentId: string | null;
  reviewedBy: string | null;
  reviewedAt: Date | null;
};

export class LeadEmailPreviewRepository {
  private readonly loadFromTransaction: (tx: Transaction, rowId: string, expectedVersion: number) => Promise<LeadEmailPreviewRepositoryResult>;
  private readonly acquireSafetyLock: (executor: CommunicationSafetyLockExecutor) => Promise<void>;

  constructor(
    private readonly database: Database,
    dependencies?: {
      loadFromTransaction?: (tx: Transaction, rowId: string, expectedVersion: number) => Promise<LeadEmailPreviewRepositoryResult>;
      acquireSafetyLock?: (executor: CommunicationSafetyLockExecutor) => Promise<void>;
    },
  ) {
    this.loadFromTransaction = dependencies?.loadFromTransaction ?? ((tx, rowId, expectedVersion) => this.loadWithinTransaction(tx, rowId, expectedVersion));
    this.acquireSafetyLock = dependencies?.acquireSafetyLock ?? acquireCommunicationSafetyLock;
  }

  async load(rowId: string, expectedVersion: number): Promise<LeadEmailPreviewRepositoryResult> {
    return this.withSerializedState(rowId, expectedVersion, (state) => state);
  }

  async withSerializedState<T>(
    rowId: string,
    expectedVersion: number,
    consume: (state: LeadEmailPreviewRepositoryResult) => T | Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (tx) => {
      await this.acquireSafetyLock(tx);
      const state = await this.loadFromTransaction(tx, rowId, expectedVersion);
      return consume(state);
    });
  }

  static isExactApprovedTemplate(candidate: TemplateCandidate): boolean {
    return isExactApprovedLeadIntroductionTemplate(candidate);
  }

  private async loadWithinTransaction(tx: Transaction, rowId: string, expectedVersion: number): Promise<LeadEmailPreviewRepositoryResult> {
    const [lead] = await tx.select({
      rowId: leadImportRows.id,
      reviewVersion: leadImportRows.reviewVersion,
      organizationId: leadImportRows.selectedOrganizationId,
      contactId: leadImportRows.selectedContactId,
      profileName: organizations.name,
      eventName: leadImportRows.confirmedEventName,
      eventCity: organizations.city,
      eventRegion: organizations.region,
      startDate: leadImportRows.confirmedStartDate,
      endDate: leadImportRows.confirmedEndDate,
      contactMode: leadImportRows.contactMode,
      confirmedContactName: leadImportRows.confirmedContactName,
      recipientEmail: leadImportRows.confirmedRecipientEmail,
      rowState: leadImportRows.state,
      recipientConfirmed: leadImportRows.recipientConfirmed,
      introductionSuitable: leadImportRows.introductionSuitable,
      relationshipOutcome: leadImportRows.relationshipOutcome,
      territoryStatus: leadImportRows.territoryStatus,
      fitStatus: leadImportRows.fitStatus,
    }).from(leadImportRows)
      .leftJoin(organizations, eq(organizations.id, leadImportRows.selectedOrganizationId))
      .where(eq(leadImportRows.id, rowId))
      .limit(1)
      .for("update", { of: leadImportRows });

    if (!lead) {
      throw new LeadEmailPreviewRepositoryError("ROW_NOT_FOUND", "Lead source row not found.");
    }
    if (lead.reviewVersion !== expectedVersion) {
      throw new LeadEmailPreviewRepositoryError(
        "VERSION_CONFLICT",
        "This lead changed in another review. Reload before previewing.",
        { expectedVersion, currentVersion: lead.reviewVersion },
      );
    }
    if (!lead.eventName || !lead.startDate || !lead.endDate || !lead.recipientEmail) {
      throw new LeadEmailPreviewRepositoryError("ROW_NOT_READY", "Verify the lead before requesting a preview.");
    }

    const [snapshot] = await tx.select().from(leadAvailabilitySnapshots)
      .where(eq(leadAvailabilitySnapshots.rowId, rowId))
      .orderBy(desc(leadAvailabilitySnapshots.checkedAt))
      .limit(1);
    const blocks = await new CommunicationBlockRepository(tx as never).listActive({
      rowId,
      organizationId: lead.organizationId,
      contactId: lead.contactId,
      recipientEmail: lead.recipientEmail,
    });
    const expected = APPROVED_LEAD_INTRODUCTION_2026;
    const [template] = await tx.select({
      id: communicationTemplates.id,
      code: communicationTemplates.code,
      templateVersion: communicationTemplates.templateVersion,
      name: communicationTemplates.name,
      state: communicationTemplates.state,
      ownerKind: communicationTemplates.ownerKind,
      createdByKind: communicationTemplates.createdByKind,
      accessScope: communicationTemplates.accessScope,
      channel: communicationTemplates.channel,
      category: communicationTemplates.category,
      subjectTemplate: communicationTemplates.subjectTemplate,
      bodyTemplate: communicationTemplates.bodyTemplate,
      allowedPlaceholders: communicationTemplates.allowedPlaceholders,
      requiredPlaceholders: communicationTemplates.requiredPlaceholders,
      sourceNote: communicationTemplates.sourceNote,
      sourceFilename: businessSourceDocuments.originalFilename,
      sourceDisplayTitle: businessSourceDocuments.displayTitle,
      sourceCategory: businessSourceDocuments.sourceCategory,
      sourceEffectiveYear: businessSourceDocuments.effectiveYear,
      sourceAccessScope: businessSourceDocuments.accessScope,
      sourceReviewState: businessSourceDocuments.reviewState,
      sourceNotes: businessSourceDocuments.notes,
      sourceStorageReference: businessSourceDocuments.storageReference,
      sourceReviewedBy: businessSourceDocuments.reviewedBy,
      sourceReviewedAt: businessSourceDocuments.reviewedAt,
      sourceDocumentId: communicationTemplates.sourceDocumentId,
      reviewedBy: communicationTemplates.reviewedBy,
      reviewedAt: communicationTemplates.reviewedAt,
    }).from(communicationTemplates)
      .innerJoin(businessSourceDocuments, eq(businessSourceDocuments.id, communicationTemplates.sourceDocumentId))
      .where(and(
        eq(communicationTemplates.code, expected.code),
        eq(communicationTemplates.templateVersion, expected.version),
        eq(communicationTemplates.state, "active"),
        eq(communicationTemplates.ownerKind, "company"),
        eq(communicationTemplates.createdByKind, "system"),
        eq(communicationTemplates.accessScope, "office"),
        eq(communicationTemplates.channel, "email"),
        eq(communicationTemplates.category, "lead_introduction"),
        eq(communicationTemplates.subjectTemplate, expected.subject),
        eq(communicationTemplates.bodyTemplate, expected.bodyTemplate),
        eq(communicationTemplates.sourceNote, expected.sourceNote),
        eq(communicationTemplates.reviewedBy, expected.reviewedBy),
        isNotNull(communicationTemplates.reviewedAt),
        eq(businessSourceDocuments.originalFilename, expected.sourceFilename),
        eq(businessSourceDocuments.displayTitle, expected.sourceDocument.displayTitle),
        eq(businessSourceDocuments.sourceCategory, expected.sourceDocument.category),
        eq(businessSourceDocuments.effectiveYear, expected.sourceDocument.effectiveYear),
        eq(businessSourceDocuments.accessScope, expected.sourceDocument.accessScope),
        eq(businessSourceDocuments.reviewState, expected.sourceDocument.reviewState),
        eq(businessSourceDocuments.notes, expected.sourceDocument.notes),
        eq(businessSourceDocuments.storageReference, expected.sourceDocument.storageReference),
        eq(businessSourceDocuments.reviewedBy, expected.sourceDocument.reviewedBy),
        isNotNull(businessSourceDocuments.reviewedAt),
      ))
      .limit(1);

    const approvedTemplate = template && LeadEmailPreviewRepository.isExactApprovedTemplate(template)
      ? {
        templateId: template.id,
        code: template.code,
        version: template.templateVersion!,
        sourceDocumentId: template.sourceDocumentId!,
        sourceFilename: template.sourceFilename!,
        reviewedBy: template.reviewedBy!,
        reviewedAt: template.reviewedAt!.toISOString(),
        definition: expected as ApprovedLeadIntroductionDefinition,
      }
      : null;

    return {
      lead: {
        ...lead,
        eventName: lead.eventName,
        startDate: lead.startDate,
        endDate: lead.endDate,
        recipientEmail: lead.recipientEmail,
        profileName: lead.profileName ?? lead.eventName,
        firstName: lead.contactMode === "organization_inbox"
          ? null
          : lead.confirmedContactName?.trim().split(/\s+/)[0] || null,
      },
      availability: snapshot ? {
        ready: snapshot.ready,
        checkedAt: snapshot.checkedAt.toISOString(),
        reviewVersion: snapshot.reviewVersion,
        proposedStartDate: snapshot.proposedStartDate,
        proposedEndDate: snapshot.proposedEndDate,
        packageAvailability: snapshot.packageAvailability,
      } : null,
      calendarEvidence: snapshot?.sourceEvents as unknown[] ?? [],
      calendarReservations: snapshot?.reservations as unknown[] ?? [],
      blocks,
      approvedTemplate,
    };
  }
}
