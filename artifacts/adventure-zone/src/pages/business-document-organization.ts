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

export type BusinessDocumentEventGroup = { label: string; documents: BusinessDocumentRecord[] };
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
  const value = document.displayName
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[_–—-]+/g, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/\b(certificate of insurance|insurance policy|vendor application|deposit receipt|operational template)\b/gi, " ")
    .replace(/\b(contracts?|agreements?|proposals?|coi|w[ -]?9|permits?|applications?|inspections?|receipts?|templates?|marketing|photos?|images?|videos?)\b/gi, " ")
    .replace(/\b(draft|final|signed|executed|revised|revision|rev|version|ver|copy)\b(?:\s*\d+)?/gi, " ")
    .replace(/[()[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return value || "General";
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
        const eventLabels = [...new Set(byYear.map(businessDocumentEvent))];
        return {
          year,
          events: eventLabels.map((label) => ({
            label,
            documents: byYear.filter((document) => businessDocumentEvent(document) === label),
          })),
        };
      }),
    }];
  });
}
