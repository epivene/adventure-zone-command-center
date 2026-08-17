export const specialRequestTreatmentValues = [
  "add_to_count",
  "replace_included",
  "note_only",
] as const;

export type SpecialRequestTreatment = (typeof specialRequestTreatmentValues)[number];

export const requestApprovalStatusValues = [
  "needs_approval",
  "approved",
  "declined",
] as const;

export type RequestApprovalStatus = (typeof requestApprovalStatusValues)[number];

export type PackageTemplateSummary = {
  id: string;
  code: string;
  name: string;
  baseAttractionCount: number;
  /** Advisory lower bound. Optional until the additive DB migration lands. */
  minimumAttractionCount?: number;
  /** Advisory upper bound. Optional until the additive DB migration lands. */
  maximumAttractionCount?: number;
};
