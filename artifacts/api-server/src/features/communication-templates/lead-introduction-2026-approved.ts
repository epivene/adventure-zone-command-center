const opening = "My name is Desiree, and I work with Dave. We represent The Adventure Zone -- America's Best Inflatable Carnival! We’d love to come to your {{eventName}}!";
const packages = {
  adventure_zone: "Our Adventure Zone units feature 10 amazing inflatable attractions, including thrilling obstacle courses, massive slides, interactive competitions, engaging carnival-style games, fun bouncy houses, and more. Check out this short video: Adventure Zone. We can offer our colorful attractions to your attendees for $9,000 (for 1-4 days).",
  pirates_rebellion: "Release your inner Pirate in our Pirate’s Rebellion unit. We bring a massive inflatable pool and paddle-style boats where players can collect pirate coins while dodging sponges from other pirate ships. Two additional water/pirate-themed inflatable attractions and carnival-style games round out this all-water unit. Check out this short video: Pirate's Rebellion. This unit is available for $8,000 (for 1-4 days).",
  weekend_warriors: "For the teenage crowd and thrill seekers, we invite you to try one of our Warrior’s Playground units. The all-star of this unit is our Action Pursuit Gaming Arena, where you can experience the adrenaline rush of Paintball, AirSoft, or Orbeez in a safe and regulated environment (ammo extra). This, plus four more exciting attractions, and carnival-style games round out this exciting unit. Check out our video here: Warrior’s Playground. This unit is available for $8,000 (for 1-4 days).",
} as const;
const services = ["complete set-up and tear-down","a supervisor and staffing for the entire event","liability insurance, with a certificate of insurance available upon request","a superb safety record entering our third decade","a fun-filled, family-friendly environment, adding a level of amusement to your event"] as const;
const closing = "Let us know how we can make that happen. If you have any questions, please let me know. We look forward to hearing from you and hope you have a phenomenal week. Take care,";
const signature = "Desiree\nThe Adventure Zone\nPH: (435) 232-4281\nEMAIL: TheAdventureZone12@gmail.com\nWEB: https://www.the-adventure-zone.com/";

const bodyTemplate = [
  "Hi, {{contactName}}",
  opening,
  `[[IF adventure_zone IS POSITIVELY AVAILABLE]]\n${packages.adventure_zone}\n[[END]]`,
  `[[IF pirates_rebellion IS POSITIVELY AVAILABLE]]\n${packages.pirates_rebellion}\n[[END]]`,
  `[[IF weekend_warriors IS POSITIVELY AVAILABLE]]\n${packages.weekend_warriors}\n[[END]]`,
  `Don’t forget, with every unit, we provide:\n\n${services.map((item) => `- ${item}`).join("\n")}`,
  `We hope to join in your {{eventCity}} celebration. ${closing}`,
  signature,
].join("\n\n");

export const APPROVED_LEAD_INTRODUCTION_2026 = {
  code: "lead_introduction_2026_prepaid",
  version: "2026-prepaid-v2",
  name: "INTRO 2026 EMAIL PREPAID",
  sourceFilename: "ADVENTURE ZONE STICKY NOTES.docx.pdf",
  sourceNote: "Amy Library: ADVENTURE ZONE STICKY NOTES.docx.pdf; owner-approved 2026 prepaid v2 with $8,000 Pirate and Warrior pricing.",
  sourceDocument: {
    storageReference: "amy-library/ADVENTURE ZONE STICKY NOTES.docx.pdf",
    displayTitle: "Adventure Zone Sticky Notes",
    category: "scripts_templates",
    effectiveYear: 2026,
    accessScope: "owner",
    reviewState: "reviewed",
    notes: "Mixed historical and current scripts, package facts, internal notes, discounts, contacts, and ACT workflow. Reviewed selectively; never publish verbatim.",
    reviewedBy: "system:business-drive-review",
  },
  reviewedBy: "system:owner-approved-2026-prepaid-v2",
  subject: "{{profileName}} {{eventLocation}} {{eventDates}}",
  allowedPlaceholders: ["profileName", "eventLocation", "eventDates", "contactName", "eventName", "eventCity"],
  requiredPlaceholders: ["eventName", "eventDates"],
  bodyTemplate,
  opening,
  packages,
  services,
  closing,
  signature,
} as const;

export type ApprovedLeadIntroductionDefinition = typeof APPROVED_LEAD_INTRODUCTION_2026;

export type ApprovedLeadIntroductionTemplateCandidate = {
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
  allowedPlaceholders: readonly string[];
  requiredPlaceholders: readonly string[];
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

function exactList(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function isExactApprovedLeadIntroductionTemplate(
  candidate: ApprovedLeadIntroductionTemplateCandidate,
): boolean {
  const expected = APPROVED_LEAD_INTRODUCTION_2026;
  return candidate.code === expected.code
    && candidate.templateVersion === expected.version
    && candidate.name === expected.name
    && candidate.state === "active"
    && candidate.ownerKind === "company"
    && candidate.createdByKind === "system"
    && candidate.accessScope === "office"
    && candidate.channel === "email"
    && candidate.category === "lead_introduction"
    && candidate.subjectTemplate === expected.subject
    && candidate.bodyTemplate === expected.bodyTemplate
    && exactList(candidate.allowedPlaceholders, expected.allowedPlaceholders)
    && exactList(candidate.requiredPlaceholders, expected.requiredPlaceholders)
    && candidate.sourceNote === expected.sourceNote
    && candidate.sourceFilename === expected.sourceFilename
    && candidate.sourceDisplayTitle === expected.sourceDocument.displayTitle
    && candidate.sourceCategory === expected.sourceDocument.category
    && candidate.sourceEffectiveYear === expected.sourceDocument.effectiveYear
    && candidate.sourceAccessScope === expected.sourceDocument.accessScope
    && candidate.sourceReviewState === expected.sourceDocument.reviewState
    && candidate.sourceNotes === expected.sourceDocument.notes
    && candidate.sourceStorageReference === expected.sourceDocument.storageReference
    && candidate.sourceReviewedBy === expected.sourceDocument.reviewedBy
    && candidate.sourceReviewedAt instanceof Date
    && Number.isFinite(candidate.sourceReviewedAt.valueOf())
    && Boolean(candidate.sourceDocumentId)
    && candidate.reviewedBy === expected.reviewedBy
    && candidate.reviewedAt instanceof Date
    && Number.isFinite(candidate.reviewedAt.valueOf());
}
