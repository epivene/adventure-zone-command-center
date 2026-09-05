export function databasePoolTimeouts() {
  return {
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 15 * 60_000,
  } as const;
}
