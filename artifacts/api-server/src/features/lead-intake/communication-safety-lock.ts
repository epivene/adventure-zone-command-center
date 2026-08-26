import { sql } from "drizzle-orm";

export type CommunicationSafetyLockExecutor = {
  execute(query: ReturnType<typeof sql>): Promise<unknown>;
};

/** Serializes preview rendering with every communication-block mutation. */
export async function acquireCommunicationSafetyLock(
  executor: CommunicationSafetyLockExecutor,
): Promise<void> {
  await executor.execute(sql`select pg_advisory_xact_lock(741237485)`);
}
