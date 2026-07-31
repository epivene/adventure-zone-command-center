type DatabaseIdentity = {
  database: string;
  host: string;
  port: string;
};

const delimitedTestToken = /(?:^|[^a-z0-9])test(?:$|[^a-z0-9])/i;
const hostOverrideParameters = ["host", "hostname", "hostaddr"] as const;

function rejectMultihostAuthority(value: string, variableName: string) {
  const separatorIndex = value.indexOf("://");
  if (separatorIndex < 0) return;
  const remainder = value.slice(separatorIndex + 3);
  const authorityEnd = remainder.search(/[/?#]/);
  const authority =
    authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd);
  const credentialSeparator = authority.indexOf("@");
  if (credentialSeparator !== authority.lastIndexOf("@")) {
    throw new Error(
      `${variableName} must use at most one raw @ credential separator.`,
    );
  }
  const hostAuthority = authority.slice(credentialSeparator + 1);
  let decodedHostAuthority: string;
  try {
    decodedHostAuthority = decodeURIComponent(hostAuthority);
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  if (decodedHostAuthority.includes(",")) {
    throw new Error(
      `${variableName} must use exactly one URL authority host.`,
    );
  }
}

function databaseIdentity(value: string, variableName: string): DatabaseIdentity {
  rejectMultihostAuthority(value, variableName);
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
  if (url.hostname.includes(",")) {
    throw new Error(
      `${variableName} must use exactly one URL authority host.`,
    );
  }
  if (hostOverrideParameters.some((name) => url.searchParams.has(name))) {
    throw new Error(
      `${variableName} must not use host override parameters.`,
    );
  }

  let database: string;
  try {
    database = decodeURIComponent(url.pathname.slice(1));
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL URL.`);
  }
  const host = url.hostname.toLowerCase().replace(/\.+$/, "");
  if (!host || !database) {
    throw new Error(`${variableName} must include a host and database name.`);
  }

  return {
    host,
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
