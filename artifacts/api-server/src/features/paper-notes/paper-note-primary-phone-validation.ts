import type { PaperNoteReviewDraft } from "./paper-note-review-initializer";
import type { PaperNoteReviewIssue } from "./paper-note-review-schema";

export function validatePaperNotePrimaryPhones(
  review: PaperNoteReviewDraft,
): PaperNoteReviewIssue[] {
  const issues: PaperNoteReviewIssue[] = [];

  const organizationPrimaryCount = review.organizationPhones.filter((phone) =>
    phone.importAsStructuredValue && phone.primary,
  ).length;
  if (organizationPrimaryCount > 1) {
    issues.push({
      fieldPath: "organizationPhones",
      severity: "blocking",
      message: "Choose only one primary organization/main-office phone.",
    });
  }

  review.contacts.forEach((contact, contactIndex) => {
    if (contact.mode !== "new_contact") return;
    const primaryCount = contact.phones.filter((phone) =>
      phone.importAsStructuredValue && phone.primary,
    ).length;
    if (primaryCount > 1) {
      issues.push({
        fieldPath: `contacts.${contactIndex}.phones`,
        severity: "blocking",
        message: "Choose only one primary phone for this new contact.",
      });
    }
  });

  return issues;
}
