import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";

type DrizzleDatabase = typeof applicationDatabase;
type Executor = Pick<DrizzleDatabase, "execute">;

function rows(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value as Array<Record<string, unknown>>;
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Array<Record<string, unknown>> : [];
}

export class ActiveProfileError extends Error {
  readonly code: "PROFILE_NOT_FOUND" | "PROFILE_ARCHIVED";

  constructor(code: "PROFILE_NOT_FOUND" | "PROFILE_ARCHIVED") {
    super(code === "PROFILE_ARCHIVED"
      ? "That profile is archived. Restore it before using it."
      : "Profile not found.");
    this.name = "ActiveProfileError";
    this.code = code;
  }
}

export async function assertActiveProfile(
  database: Executor,
  profileId: string,
): Promise<void> {
  const record = rows(await database.execute(sql`
    select archived_at as "archivedAt"
    from organizations
    where id = ${profileId}::uuid
    limit 1
  `))[0];
  if (!record) throw new ActiveProfileError("PROFILE_NOT_FOUND");
  if (record.archivedAt != null) throw new ActiveProfileError("PROFILE_ARCHIVED");
}

export async function isActiveProfile(
  database: Executor,
  profileId: string,
): Promise<boolean> {
  try {
    await assertActiveProfile(database, profileId);
    return true;
  } catch (error) {
    if (error instanceof ActiveProfileError) return false;
    throw error;
  }
}

export async function activeProfileIdSet(
  database: Executor,
  profileIds: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(profileIds)].filter(Boolean);
  if (!unique.length) return new Set();
  const idList = sql.join(unique.map((id) => sql`${id}::uuid`), sql`, `);
  const records = rows(await database.execute(sql`
    select id
    from organizations
    where archived_at is null
      and id in (${idList})
  `));
  return new Set(records.map((record) => String(record.id ?? "")).filter(Boolean));
}
