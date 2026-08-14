import { sql } from "drizzle-orm";

type SqlExecutor = { execute(query: ReturnType<typeof sql>): Promise<unknown> };

const profileLinkMutex = "adventure-zone:act-profile-link-mutations:v1";

/** Acquired before either apply path locks any profile or external-link row. */
export async function lockProfileLinkTransaction(executor: SqlExecutor): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(hashtext(${profileLinkMutex}))`);
}
