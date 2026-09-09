import type { BusinessDocumentCategory, BusinessDocumentRecord } from "@/lib/business-documents-api";

const mediaExtensions = new Set([
  "avi", "bmp", "gif", "heic", "heif", "jpeg", "jpg", "m4v", "mkv", "mov", "mp4", "png", "svg", "tif", "tiff", "webm", "webp",
]);

const categoryOrder: BusinessDocumentCategory[] = [
  "contract", "proposal", "vendor_application", "coi", "insurance_policy", "permit", "inspection",
  "w9_tax", "deposit_receipt", "operational_template", "marketing", "other",
];

const categoryLabels: Record<BusinessDocumentCategory, string> = {
  contract: "Contracts",
  proposal: "Proposals",
  coi: "COIs",
  insurance_policy: "Insurance Policies",
  w9_tax: "W-9 & Tax Documents",
  permit: "Permits",
  vendor_application: "Vendor Applications",
  inspection: "Inspections",
  deposit_receipt: "Deposit Receipts",
  operational_template: "Operational Templates",
  marketing: "Promo Materials",
  other: "Other Documents",
};

export type BusinessDocumentEventGroup = { key: string; label: string; documents: BusinessDocumentRecord[] };
export type BusinessDocumentYearGroup = { year: string; events: BusinessDocumentEventGroup[] };
export type BusinessDocumentTypeGroup = { key: string; label: string; years: BusinessDocumentYearGroup[] };

export function isMediaDocument(document: BusinessDocumentRecord) {
  const extension = document.originalFilename.split(".").pop()?.toLowerCase() ?? "";
  return mediaExtensions.has(extension);
}

export function businessDocumentYear(document: BusinessDocumentRecord) {
  const dated = [document.effectiveDate, document.issueDate, document.expirationDate]
    .map((value) => value?.match(/\b20\d{2}\b/)?.[0])
    .find(Boolean);
  if (dated) return dated;
  const named = [document.displayName, document.originalFilename]
    .map((value) => value.match(/\b20\d{2}\b/)?.[0])
    .find(Boolean);
  return named ?? document.createdAt.slice(0, 4);
}

export function businessDocumentEvent(document: BusinessDocumentRecord) {
  const priority = { booking: 0, profile: 1, event_family: 2 } as const;
  const link = [...document.links]
    .filter((candidate) => candidate.targetLabel?.trim())
    .sort((left, right) => priority[left.targetKind] - priority[right.targetKind])[0];
  if (!link) return { key: "needs-sorting", label: "Needs Sorting" };
  return { key: `${link.targetKind}:${link.targetId}`, label: link.targetLabel!.trim() };
}

export function groupBusinessDocuments(documents: BusinessDocumentRecord[], options: { media?: boolean } = {}) {
  const includeMedia = options.media === true;
  const scoped = documents.filter((document) => isMediaDocument(document) === includeMedia);
  const typeKeys = includeMedia ? ["media"] : categoryOrder;

  return typeKeys.flatMap((typeKey): BusinessDocumentTypeGroup[] => {
    const byType = includeMedia ? scoped : scoped.filter((document) => document.category === typeKey);
    if (!byType.length) return [];
    const years = [...new Set(byType.map(businessDocumentYear))].sort((left, right) => right.localeCompare(left));
    return [{
      key: typeKey,
      label: includeMedia ? "Media" : categoryLabels[typeKey as BusinessDocumentCategory],
      years: years.map((year) => {
        const byYear = byType.filter((document) => businessDocumentYear(document) === year);
        const events = [...new Map(byYear.map((document) => {
          const event = businessDocumentEvent(document);
          return [event.key, event];
        })).values()];
        return {
          year,
          events: events.map((event) => ({
            ...event,
            documents: byYear.filter((document) => businessDocumentEvent(document).key === event.key),
          })),
        };
      }),
    }];
  });
}
