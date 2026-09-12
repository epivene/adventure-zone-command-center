const postgresConstraintCodes = new Set(["23503", "23505", "23514"]);

export function organizationMergeFailureMessage(error: unknown): string {
  if (!error || typeof error !== "object") return "Failed to merge profiles";

  const code = "code" in error && typeof error.code === "string" ? error.code : null;
  if (!code || !postgresConstraintCodes.has(code)) return "Failed to merge profiles";

  const constraint =
    "constraint" in error && typeof error.constraint === "string"
      ? error.constraint
      : null;
  return constraint
    ? `Failed to merge profiles (${code}: ${constraint})`
    : `Failed to merge profiles (${code})`;
}
