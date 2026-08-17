import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { recordAuditEntry } from "@/features/audit/audit-service";

export type ProfileArchiveState = {
  id: string;
  archivedAt: Date | null;
};

export type ArchivedProfileSummary = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  archivedAt: Date;
};

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function dateOrNull(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export class ProfileLifecycleError extends Error {
  readonly code: "PROFILE_NOT_FOUND";

  constructor() {
    super("Profile not found.");
    this.name = "ProfileLifecycleError";
    this.code = "PROFILE_NOT_FOUND";
  }
}

export class ProfileLifecycleRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  private async query(executor: Pick<DrizzleDatabase, "execute">, query: ReturnType<typeof sql>) {
    return rows(await executor.execute(query));
  }

  async archive(profileId: string, actorId: string | null): Promise<ProfileArchiveState> {
    return this.database.transaction(async (transaction) => {
      const current = (await this.query(transaction as never, sql`
        select id, archived_at as "archivedAt"
        from organizations
        where id = ${profileId}::uuid
        for update
      `))[0];
      if (!current) throw new ProfileLifecycleError();
      const existingArchivedAt = dateOrNull(current.archivedAt);
      if (existingArchivedAt) return { id: profileId, archivedAt: existingArchivedAt };

      const archivedAt = new Date();
      const updated = (await this.query(transaction as never, sql`
        update organizations
        set archived_at = ${archivedAt}, updated_at = ${archivedAt}
        where id = ${profileId}::uuid
        returning id, archived_at as "archivedAt"
      `))[0];
      if (!updated) throw new ProfileLifecycleError();

      await recordAuditEntry(transaction as never, {
        entityType: "organization",
        entityId: profileId,
        action: "archive_profile",
        before: { archivedAt: null, actorId },
        after: { archivedAt: archivedAt.toISOString(), actorId },
      });
      return { id: text(updated.id), archivedAt: dateOrNull(updated.archivedAt) };
    });
  }

  async restore(profileId: string, actorId: string | null): Promise<ProfileArchiveState> {
    return this.database.transaction(async (transaction) => {
      const current = (await this.query(transaction as never, sql`
        select id, archived_at as "archivedAt"
        from organizations
        where id = ${profileId}::uuid
        for update
      `))[0];
      if (!current) throw new ProfileLifecycleError();
      const archivedAt = dateOrNull(current.archivedAt);
      if (!archivedAt) return { id: profileId, archivedAt: null };

      const restoredAt = new Date();
      const updated = (await this.query(transaction as never, sql`
        update organizations
        set archived_at = null, updated_at = ${restoredAt}
        where id = ${profileId}::uuid
        returning id, archived_at as "archivedAt"
      `))[0];
      if (!updated) throw new ProfileLifecycleError();

      await recordAuditEntry(transaction as never, {
        entityType: "organization",
        entityId: profileId,
        action: "restore_profile",
        before: { archivedAt: archivedAt.toISOString(), actorId },
        after: { archivedAt: null, actorId },
      });
      return { id: text(updated.id), archivedAt: null };
    });
  }

  async listArchived(): Promise<ArchivedProfileSummary[]> {
    const records = await this.query(this.database, sql`
      select id, name, city, region, archived_at as "archivedAt"
      from organizations
      where archived_at is not null
      order by archived_at desc, name asc
    `);

    return records.flatMap((record) => {
      const archivedAt = dateOrNull(record.archivedAt);
      const id = text(record.id);
      if (!archivedAt || !id) return [];
      return [{
        id,
        name: text(record.name) || "Unnamed profile",
        city: text(record.city) || null,
        region: text(record.region) || null,
        archivedAt,
      }];
    });
  }
}
