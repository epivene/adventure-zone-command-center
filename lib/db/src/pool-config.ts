export function databasePoolTimeouts() {
  return {
    connectionTimeoutMillis: 5_000,
    // Reuse bounded pool connections across normal navigation and badge polling.
    // pg defaults to closing them after only ten idle seconds.
    idleTimeoutMillis: 5 * 60_000,
    query_timeout: 30_000,
    statement_timeout: 15 * 60_000,
  } as const;
}
