import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { legManagerAccess, travelLegs } from "@/db/schema";

export type LegManagerAccessRecord = {
  legId: string;
  legName: string;
  passwordHash: string;
  passwordSalt: string;
  sessionVersion: number;
};

export type LegManagerAdminStatus = {
  legId: string;
  legName: string;
  archivedAt: Date | null;
  enabled: boolean;
  sessionVersion: number | null;
};

export class DrizzleLegManagerRepository {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async getActiveAccess(legId: string): Promise<LegManagerAccessRecord | null> {
    const rows = await this.database
      .select({
        legId: legManagerAccess.legId,
        legName: travelLegs.name,
        passwordHash: legManagerAccess.passwordHash,
        passwordSalt: legManagerAccess.passwordSalt,
        sessionVersion: legManagerAccess.sessionVersion,
      })
      .from(legManagerAccess)
      .innerJoin(travelLegs, eq(travelLegs.id, legManagerAccess.legId))
      .where(and(eq(legManagerAccess.legId, legId), isNull(travelLegs.archivedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  async listLoginLegs() {
    return this.database
      .select({ id: travelLegs.id, name: travelLegs.name })
      .from(travelLegs)
      .innerJoin(legManagerAccess, eq(legManagerAccess.legId, travelLegs.id))
      .where(isNull(travelLegs.archivedAt))
      .orderBy(asc(travelLegs.sortOrder));
  }

  async setPassword(input: {
    legId: string;
    passwordHash: string;
    passwordSalt: string;
  }): Promise<LegManagerAccessRecord | null> {
    const active = await this.database
      .select({ id: travelLegs.id, name: travelLegs.name })
      .from(travelLegs)
      .where(and(eq(travelLegs.id, input.legId), isNull(travelLegs.archivedAt)))
      .limit(1);
    if (!active[0]) return null;

    await this.database
      .insert(legManagerAccess)
      .values({
        legId: input.legId,
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        managerName: active[0].name,
        sessionVersion: 1,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: legManagerAccess.legId,
        set: {
          passwordHash: input.passwordHash,
          passwordSalt: input.passwordSalt,
          managerName: active[0].name,
          sessionVersion: sql`${legManagerAccess.sessionVersion}+1`,
          updatedAt: new Date(),
        },
      });

    return this.getActiveAccess(input.legId);
  }

  async incrementSessionVersion(legId: string) {
    const rows = await this.database
      .update(legManagerAccess)
      .set({
        sessionVersion: sql`${legManagerAccess.sessionVersion}+1`,
        updatedAt: new Date(),
      })
      .where(eq(legManagerAccess.legId, legId))
      .returning({ legId: legManagerAccess.legId });
    return rows.length > 0;
  }

  async listAdminStatuses(): Promise<LegManagerAdminStatus[]> {
    return this.database
      .select({
        legId: travelLegs.id,
        legName: travelLegs.name,
        archivedAt: travelLegs.archivedAt,
        enabled: sql<boolean>`${legManagerAccess.legId} is not null`,
        sessionVersion: legManagerAccess.sessionVersion,
      })
      .from(travelLegs)
      .leftJoin(legManagerAccess, eq(legManagerAccess.legId, travelLegs.id))
      .orderBy(asc(travelLegs.sortOrder));
  }
}
