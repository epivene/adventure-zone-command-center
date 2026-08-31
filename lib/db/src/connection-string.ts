const CURRENT_VERIFY_FULL_ALIASES = new Set(["prefer", "require", "verify-ca"]);

export function normalizeDatabaseConnectionString(
  connectionString: string,
  options: { isRender: boolean },
): string {
  if (!options.isRender) return connectionString;

  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode")?.toLowerCase() ?? null;

  if (sslMode === null || CURRENT_VERIFY_FULL_ALIASES.has(sslMode)) {
    url.searchParams.set("sslmode", "verify-full");
  }

  return url.toString();
}
