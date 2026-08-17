import { and, desc, eq, isNotNull } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { organizations } from "@/db/schema";
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

  async archive(profileId: string, actorId: string | null): Promise<ProfileArchiveState> {
    return this.database.transaction(async (transaction) => {
      const [profile] = await transaction
        .select({ id: organizations.id, archivedAt: organizations.archivedAt })
        .from(organizations)
        .where(eq(organizations.id, profileId))
        .limit(1)
        .for("update");
      if (!profile) throw new ProfileLifecycleError();
      if (profile.archivedAt) return profile;

      const archivedAt = new Date();
      const [updated] = await transaction
        .update(organizations)
        .set({ archivedAt, updatedAt: archivedAt })
        .where(and(eq(organizations.id, profileId), isNotNull(organizations.id)))
        .returning({ id: organizations.id, archivedAt: organizations.archivedAt });
      if (!updated) throw new ProfileLifecycleError();

      await recordAuditEntry(transaction, {
        entityType: "organization",
        entityId: profileId,
        action: "archive_profile",
        before: { archivedAt: null, actorId },
        after: { archivedAt: archivedAt.toISOString(), actorId },
      });
      return updated;
    });
  }

  async restore(profileId: string, actorId: string | null): Promise<ProfileArchiveState> {
    return this.database.transaction(async (transaction) => {
      const [profile] = await transaction
        .select({ id: organizations.id, archivedAt: organizations.archivedAt })
        .from(organizations)
        .where(eq(organizations.id, profileId))
        .limit(1)
        .for("update");
      if (!profile) throw new ProfileLifecycleError();
      if (!profile.archivedAt) return profile;

      const restoredAt = new Date();
      const [updated] = await transaction
        .update(organizations)
        .set({ archivedAt: null, updatedAt: restoredAt })
        .where(eq(organizations.id, profileId))
        .returning({ id: organizations.id, archivedAt: organizations.archivedAt });
      if (!updated) throw new ProfileLifecycleError();

      await recordAuditEntry(transaction, {
        entityType: "organization",
        entityId: profileId,
        action: "restore_profile",
        before: { archivedAt: profile.archivedAt.toISOString(), actorId },
        after: { archivedAt: null, actorId },
      });
      return updated;
    });
  }

  async listArchived(): Promise<ArchivedProfileSummary[]> {
    const records = await this.database
      .select({
        id: organizations.id,
        name: organizations.name,
        city: organizations.city,
        region: organizations.region,
        archivedAt: organizations.archivedAt,
      })
      .from(organizations)
      .where(isNotNull(organizations.archivedAt))
      .orderBy(desc(organizations.archivedAt), organizations.name);

    return records.flatMap((record) => record.archivedAt ? [{ ...record, archivedAt: record.archivedAt }] : []);
  }
}
