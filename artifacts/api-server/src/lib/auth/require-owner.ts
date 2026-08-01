// In Express we use requireOwnerMiddleware from ../auth instead.
// This stub exists so copied feature files that import it still compile.
export async function requireOwner(): Promise<void> {
  // No-op in the Express context — auth is enforced by middleware on the router.
}
