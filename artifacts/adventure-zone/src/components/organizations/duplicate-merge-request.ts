type DuplicateClassification =
  | "duplicate"
  | "location_candidate"
  | "ambiguous_location_candidate";

export function buildDuplicateMergeRequest(input: {
  classification: DuplicateClassification;
  primaryId: string;
  duplicateIds: string[];
}) {
  const request = {
    primaryId: input.primaryId,
    duplicateIds: input.duplicateIds,
  };

  return input.classification === "duplicate"
    ? request
    : { ...request, reviewedLocationConflict: true as const };
}
