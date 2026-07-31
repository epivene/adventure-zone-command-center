type DatabaseIdentity = {
  database: string;
  host: string;
  port: string;
};

const delimitedTestToken = /(?:^|[^a-z0-9])test(?:$|[^a-z0-9])/i;

function databaseIdentity(value: string, variableName: string): DatabaseIdentity {
  let url: URL;
  try {
    if (value.trim() !== value) throw new Error("surrounding whitespace");
    url = new URL(value);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }

  let database: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (!url.hostname || !database) {
    throw new Error(`${variableName} must include a host and database name.`);
  }

  return {
    host: url.hostname.toLowerCase(),
    port: url.port || "5432",
    database: database.toLowerCase(),
  };
}

function sameDatabase(
  left: DatabaseIdentity,
  right: DatabaseIdentity,
) {
  return (
    left.host === right.host &&
    left.port === right.port &&
    left.database === right.database
  );
}

export function crmTestDatabaseUrl(
  environment: Record<string, string | undefined> = process.env,
) {
  const databaseUrl = environment.CRM_TEST_DATABASE_URL;
  if (!databaseUrl && environment.CRM_RELEASE_TESTS === "1") {
    throw new Error("CRM_TEST_DATABASE_URL must be set when CRM_RELEASE_TESTS=1.");
  }
  if (!databaseUrl) return undefined;

  const testIdentity = databaseIdentity(
    databaseUrl,
    "CRM_TEST_DATABASE_URL",
  );
  if (!delimitedTestToken.test(testIdentity.database)) {
    throw new Error(
      "CRM_TEST_DATABASE_URL database name must contain a delimited 'test' token.",
    );
  }

  if (environment.DATABASE_URL) {
    const applicationIdentity = databaseIdentity(
      environment.DATABASE_URL,
      "DATABASE_URL",
    );
    if (sameDatabase(testIdentity, applicationIdentity)) {
      throw new Error(
        "CRM_TEST_DATABASE_URL must not identify the same database as DATABASE_URL.",
      );
    }
  }
  return databaseUrl;
}
