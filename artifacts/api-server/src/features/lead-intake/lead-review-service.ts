import { and, eq, inArray, isNull } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { contacts, leadImportEvidence, leadImportRows, organizationContacts, organizations } from "@/db/schema";
import { evaluateLeadReview, type LeadReviewBlocker, type LeadReviewDecision } from "./lead-review-policy";

type DrizzleDatabase = typeof database;

export class LeadReviewServiceError extends Error {
  constructor(
    public readonly code: "ROW_NOT_FOUND" | "VERSION_CONFLICT" | "REVIEW_BLOCKED",
    message: string,
    public readonly blockers: LeadReviewBlocker[] = [],
  ) {
    super(message);
    this.name = "LeadReviewServiceError";
  }
}

export class LeadReviewService {
  constructor(private readonly database: DrizzleDatabase) {}

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
}
