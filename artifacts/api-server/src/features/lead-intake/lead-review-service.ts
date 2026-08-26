import { and, eq, inArray, isNull } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { contacts, leadImportEvidence, leadImportRows, organizationContacts, organizations } from "@/db/schema";
import { evaluateLeadReview, type LeadReviewBlocker, type LeadReviewDecision } from "./lead-review-policy";
import { classifyLeadRelationship } from "./lead-relationship-classifier";
import type { LeadRelationshipEvidenceSource } from "./lead-relationship-evidence-repository";

type DrizzleDatabase = typeof database;

export class LeadReviewServiceError extends Error {
  constructor(
    public readonly code: "ROW_NOT_FOUND" | "VERSION_CONFLICT" | "REVIEW_BLOCKED" | "RELATIONSHIP_NOT_READY",
    message: string,
    public readonly blockers: LeadReviewBlocker[] = [],
  ) {
    super(message);
    this.name = "LeadReviewServiceError";
  }
}

export class LeadReviewService {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly relationshipEvidence?: LeadRelationshipEvidenceSource,
  ) {}

  async confirm(input: {
    rowId: string;
    expectedVersion: number;
    reviewedBy: string;
    decision: LeadReviewDecision;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.database.transaction(async (tx) => {
      const [row] = await tx.select({ id: leadImportRows.id, reviewVersion: leadImportRows.reviewVersion })
        .from(leadImportRows).where(eq(leadImportRows.id, input.rowId)).limit(1).for("update");
      if (!row) throw new LeadReviewServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
      if (row.reviewVersion !== input.expectedVersion) {
        throw new LeadReviewServiceError("VERSION_CONFLICT", "This lead was changed in another review. Reload it before saving.");
      }

      const [organization] = await tx.select({ id: organizations.id }).from(organizations)
        .where(and(eq(organizations.id, input.decision.organizationId!), isNull(organizations.consolidatedIntoId)))
        .limit(1);
      const profileExists = Boolean(organization);
      let contactBelongsToOrganization = input.decision.contactMode === "manual";
      let contactEmailMatchesRecipient = input.decision.contactMode === "manual";
      const profileContacts = profileExists
        ? await tx.select({ contactId: contacts.id, email: contacts.email }).from(organizationContacts)
          .innerJoin(contacts, eq(contacts.id, organizationContacts.contactId))
          .where(and(
            eq(organizationContacts.organizationId, input.decision.organizationId!),
            eq(organizationContacts.active, true),
          ))
        : [];
      if (input.decision.contactMode === "existing" && input.decision.contactId) {
        const membership = profileContacts.find((item) => item.contactId === input.decision.contactId);
        contactBelongsToOrganization = Boolean(membership);
        contactEmailMatchesRecipient = Boolean(
          membership?.email && membership.email.trim().toLowerCase() === input.decision.recipientEmail.trim().toLowerCase(),
        );
      }

      const review = evaluateLeadReview({
        ...input.decision,
        organizationId: profileExists ? input.decision.organizationId : null,
        contactBelongsToOrganization,
        contactEmailMatchesRecipient,
        candidateEmails: profileContacts.map((item) => item.email).filter((value): value is string => Boolean(value)),
      });
      if (!review.verified) {
        throw new LeadReviewServiceError("REVIEW_BLOCKED", "Complete every required review field before verifying this lead.", review.blockers);
      }

      const nextVersion = row.reviewVersion + 1;
      const [updated] = await tx.update(leadImportRows).set({
        state: "verified",
        reviewVersion: nextVersion,
        selectedOrganizationId: input.decision.organizationId,
        selectedContactId: input.decision.contactMode === "existing" ? input.decision.contactId : null,
        contactMode: input.decision.contactMode,
        confirmedEventName: input.decision.eventName.trim(),
        confirmedStartDate: input.decision.startDate,
        confirmedEndDate: input.decision.endDate,
        confirmedContactName: input.decision.contactMode === "organization_inbox" ? null : input.decision.contactName.trim(),
        confirmedContactRole: input.decision.contactMode === "organization_inbox" ? null : input.decision.contactRole.trim(),
        confirmedRecipientEmail: input.decision.recipientEmail.trim().toLowerCase(),
        recipientConfirmed: true,
        introductionSuitable: true,
        confirmedBy: input.reviewedBy.trim() || "owner",
        confirmedAt: now,
        relationshipOutcome: null,
        relationshipAnchorAt: null,
        relationshipCutoffDate: null,
        relationshipEvidenceIds: [],
        latestOutboundAt: null,
        latestVerifiedResponseAt: null,
        relationshipReviewRequired: false,
        relationshipClassifiedAt: null,
        relationshipClassifiedBy: null,
        updatedAt: now,
      }).where(and(
        eq(leadImportRows.id, input.rowId),
        eq(leadImportRows.reviewVersion, input.expectedVersion),
      )).returning({ id: leadImportRows.id });
      if (!updated) throw new LeadReviewServiceError("VERSION_CONFLICT", "This lead changed before the review could be saved.");

      await tx.delete(leadImportEvidence).where(and(
        eq(leadImportEvidence.rowId, input.rowId),
        inArray(leadImportEvidence.field, ["event_dates", "recipient_email"]),
        eq(leadImportEvidence.selected, true),
      ));
      await tx.insert(leadImportEvidence).values([
        {
          rowId: input.rowId,
          field: "event_dates",
          candidateValue: `${input.decision.startDate}/${input.decision.endDate}`,
          sourceKind: input.decision.dateEvidence.sourceKind,
          sourceReference: input.decision.dateEvidence.sourceReference.trim(),
          selected: true,
          createdBy: input.reviewedBy.trim() || "owner",
          createdAt: now,
        },
        {
          rowId: input.rowId,
          field: "recipient_email",
          candidateValue: input.decision.recipientEmail.trim().toLowerCase(),
          sourceKind: input.decision.emailEvidence.sourceKind,
          sourceReference: input.decision.emailEvidence.sourceReference.trim(),
          selected: true,
          createdBy: input.reviewedBy.trim() || "owner",
          createdAt: now,
        },
      ]);
      return { rowId: input.rowId, state: "verified" as const, reviewVersion: nextVersion };
    });
  }

  async classifyRelationship(input: {
    rowId: string;
    expectedVersion: number;
    reviewedBy: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const relationshipEvidence = this.relationshipEvidence;
    if (!relationshipEvidence) {
      throw new LeadReviewServiceError(
        "RELATIONSHIP_NOT_READY",
        "Previous-contact evidence is not available yet.",
      );
    }
    const [snapshot] = await this.database.select({
      id: leadImportRows.id,
      state: leadImportRows.state,
      reviewVersion: leadImportRows.reviewVersion,
      organizationId: leadImportRows.selectedOrganizationId,
      recipientEmail: leadImportRows.confirmedRecipientEmail,
      recipientConfirmed: leadImportRows.recipientConfirmed,
      introductionSuitable: leadImportRows.introductionSuitable,
    }).from(leadImportRows).where(eq(leadImportRows.id, input.rowId)).limit(1);
    if (!snapshot) {
      throw new LeadReviewServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
    }
    if (snapshot.reviewVersion !== input.expectedVersion) {
      throw new LeadReviewServiceError(
        "VERSION_CONFLICT",
        "This lead was changed in another review. Reload it before classifying previous contact.",
      );
    }
    if (
      snapshot.state !== "verified" ||
      !snapshot.organizationId ||
      !snapshot.recipientEmail?.trim() ||
      !snapshot.recipientConfirmed ||
      !snapshot.introductionSuitable
    ) {
      throw new LeadReviewServiceError(
        "RELATIONSHIP_NOT_READY",
        "Verify the profile and intended recipient before checking previous contact.",
      );
    }
    const organizationId = snapshot.organizationId;
    const recipientEmail = snapshot.recipientEmail;
    const evidence = await relationshipEvidence.list({
      organizationId,
      recipientEmail,
    });
    const classification = classifyLeadRelationship({
      organizationId,
      recipientEmail,
      anchor: now,
      evidence,
    });
    return this.database.transaction(async (tx) => {
      const [row] = await tx.select({
        id: leadImportRows.id,
        state: leadImportRows.state,
        reviewVersion: leadImportRows.reviewVersion,
        organizationId: leadImportRows.selectedOrganizationId,
        recipientEmail: leadImportRows.confirmedRecipientEmail,
        recipientConfirmed: leadImportRows.recipientConfirmed,
        introductionSuitable: leadImportRows.introductionSuitable,
        relationshipOutcome: leadImportRows.relationshipOutcome,
        relationshipAnchorAt: leadImportRows.relationshipAnchorAt,
        relationshipCutoffDate: leadImportRows.relationshipCutoffDate,
        relationshipEvidenceIds: leadImportRows.relationshipEvidenceIds,
        latestOutboundAt: leadImportRows.latestOutboundAt,
        latestVerifiedResponseAt: leadImportRows.latestVerifiedResponseAt,
        relationshipReviewRequired: leadImportRows.relationshipReviewRequired,
      }).from(leadImportRows)
        .where(eq(leadImportRows.id, input.rowId))
        .limit(1)
        .for("update");
      if (!row) {
        throw new LeadReviewServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
      }
      if (row.reviewVersion !== input.expectedVersion) {
        throw new LeadReviewServiceError(
          "VERSION_CONFLICT",
          "This lead was changed in another review. Reload it before classifying previous contact.",
        );
      }
      if (
        row.state !== "verified" ||
        !row.organizationId ||
        !row.recipientEmail?.trim() ||
        !row.recipientConfirmed ||
        !row.introductionSuitable
      ) {
        throw new LeadReviewServiceError(
          "RELATIONSHIP_NOT_READY",
          "Verify the profile and intended recipient before checking previous contact.",
        );
      }
      if (
        row.organizationId !== organizationId
        || row.recipientEmail.trim().toLowerCase() !== recipientEmail.trim().toLowerCase()
      ) {
        throw new LeadReviewServiceError(
          "VERSION_CONFLICT",
          "The verified profile or recipient changed while previous contact was being checked. Reload and try again.",
        );
      }
      const sameTimestamp = (left: Date | null, right: Date | null) =>
        left?.valueOf() === right?.valueOf() && (left !== null) === (right !== null);
      const unchanged = row.relationshipOutcome === classification.outcome
        && row.relationshipAnchorAt?.valueOf() === now.valueOf()
        && row.relationshipCutoffDate === classification.cutoffDate
        && JSON.stringify(row.relationshipEvidenceIds) === JSON.stringify(classification.evidenceIds)
        && sameTimestamp(row.latestOutboundAt, classification.latestOutboundAt)
        && sameTimestamp(row.latestVerifiedResponseAt, classification.latestVerifiedResponseAt)
        && row.relationshipReviewRequired === classification.reviewRequired;
      if (unchanged) {
        return { rowId: input.rowId, reviewVersion: row.reviewVersion, ...classification };
      }

      const nextVersion = row.reviewVersion + 1;
      const [updated] = await tx.update(leadImportRows).set({
        reviewVersion: nextVersion,
        relationshipOutcome: classification.outcome,
        relationshipAnchorAt: now,
        relationshipCutoffDate: classification.cutoffDate,
        relationshipEvidenceIds: classification.evidenceIds,
        latestOutboundAt: classification.latestOutboundAt,
        latestVerifiedResponseAt: classification.latestVerifiedResponseAt,
        relationshipReviewRequired: classification.reviewRequired,
        relationshipClassifiedAt: now,
        relationshipClassifiedBy: input.reviewedBy.trim() || "owner",
        updatedAt: now,
      }).where(and(
        eq(leadImportRows.id, input.rowId),
        eq(leadImportRows.reviewVersion, input.expectedVersion),
      )).returning({ id: leadImportRows.id });
      if (!updated) {
        throw new LeadReviewServiceError(
          "VERSION_CONFLICT",
          "This lead changed before previous contact could be classified.",
        );
      }
      return { rowId: input.rowId, reviewVersion: nextVersion, ...classification };
    });
  }

  async listRelationshipEvidence(input: { rowId: string }) {
    const relationshipEvidence = this.relationshipEvidence;
    if (!relationshipEvidence) {
      throw new LeadReviewServiceError("RELATIONSHIP_NOT_READY", "Previous-contact evidence is not available yet.");
    }
    const [row] = await this.database.select({
      state: leadImportRows.state,
      organizationId: leadImportRows.selectedOrganizationId,
      recipientEmail: leadImportRows.confirmedRecipientEmail,
      recipientConfirmed: leadImportRows.recipientConfirmed,
      introductionSuitable: leadImportRows.introductionSuitable,
      relationshipOutcome: leadImportRows.relationshipOutcome,
      relationshipEvidenceIds: leadImportRows.relationshipEvidenceIds,
    }).from(leadImportRows).where(eq(leadImportRows.id, input.rowId)).limit(1);
    if (!row) throw new LeadReviewServiceError("ROW_NOT_FOUND", "Lead import row was not found.");
    if (
      row.state !== "verified" || !row.organizationId || !row.recipientEmail?.trim()
      || !row.recipientConfirmed || !row.introductionSuitable || !row.relationshipOutcome
    ) {
      throw new LeadReviewServiceError(
        "RELATIONSHIP_NOT_READY",
        "Classify previous contact before viewing its evidence.",
      );
    }
    const selectedIds = new Set(row.relationshipEvidenceIds);
    const evidence = await relationshipEvidence.list({
      organizationId: row.organizationId,
      recipientEmail: row.recipientEmail,
    });
    return evidence.filter((item) => selectedIds.has(item.evidenceId)).map((item) => ({
      evidenceId: item.evidenceId,
      sourceType: item.sourceType,
      occurredAt: Number.isFinite(item.occurredAt.valueOf()) ? item.occurredAt : null,
      direction: item.direction,
      responseProven: item.responseProven,
      excerpt: item.excerpt,
      conflicting: item.conflicting,
    }));
  }
}
