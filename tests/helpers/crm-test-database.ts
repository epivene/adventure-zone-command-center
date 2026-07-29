export function crmTestDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
) {
  const databaseUrl = environment.CRM_TEST_DATABASE_URL;
  if (!databaseUrl && environment.CRM_RELEASE_TESTS === "1") {
    throw new Error("CRM_TEST_DATABASE_URL must be set when CRM_RELEASE_TESTS=1.");
  }
  return databaseUrl;
}
