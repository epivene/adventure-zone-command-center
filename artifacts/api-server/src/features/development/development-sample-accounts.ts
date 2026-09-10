import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { bossAccounts, legManagerAccess, officeAccounts, travelLegs } from "@/db/schema";
import { hashPasswordCredential } from "@/lib/password-credential";

export const DEVELOPMENT_SAMPLE_LEG_ID =
  "10000000-0000-4000-8000-000000000005";

export const DEVELOPMENT_SAMPLE_LOGINS = {
  office: {
    loginName: "demo-office",
    displayName: "Demo Office Coordinator",
    password: "OfficeDemo2026!",
  },
  manager: {
    legId: DEVELOPMENT_SAMPLE_LEG_ID,
    legName: "Demo Rocky Mountain Route",
    password: "LegDemo2026!",
  },
  boss: { loginName: "demo-boss", displayName: "Demo Dave", password: "BossDemo2026!" },
} as const;

/**
 * Development-only fixtures for exercising both role-specific portals.
 *
 * Existing records are intentionally left alone so a developer can change or
 * disable the sample accounts through the owner tools without startup undoing
 * that choice.
 */
export async function ensureDevelopmentSampleAccounts(): Promise<void> {
  if (process.env.NODE_ENV !== "development") return;

  const existingLeg = await db
    .select({ id: travelLegs.id })
    .from(travelLegs)
    .where(eq(travelLegs.id, DEVELOPMENT_SAMPLE_LEG_ID))
    .limit(1);

  if (!existingLeg[0]) {
    const [{ nextSortOrder }] = await db
      .select({
        nextSortOrder: sql<number>`coalesce(max(${travelLegs.sortOrder}), 0) + 1`,
      })
      .from(travelLegs);

    await reconcileCapacityFacts(db,"resource-inventory",async tx=>tx.insert(travelLegs).values({
      id: DEVELOPMENT_SAMPLE_LEG_ID,
      name: DEVELOPMENT_SAMPLE_LOGINS.manager.legName,
      color: "#F97316",
      sortOrder: Number(nextSortOrder),
      baseAddress: "Denver, CO",
      defaultVehicleName: "Demo Adventure Van",
      defaultMpg: 22,
    }));
  }

  const existingOffice = await db
    .select({ id: officeAccounts.id })
    .from(officeAccounts)
    .where(
      sql`lower(${officeAccounts.loginName}) = lower(${DEVELOPMENT_SAMPLE_LOGINS.office.loginName})`,
    )
    .limit(1);

  if (!existingOffice[0]) {
    const credential = await hashPasswordCredential(
      DEVELOPMENT_SAMPLE_LOGINS.office.password,
    );
    await db.insert(officeAccounts).values({
      loginName: DEVELOPMENT_SAMPLE_LOGINS.office.loginName,
      displayName: DEVELOPMENT_SAMPLE_LOGINS.office.displayName,
      role: "office_coordinator",
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      enabled: true,
      sessionVersion: 1,
    });
  }
  const [studioOffice] = await db.select({ id: officeAccounts.id }).from(officeAccounts).where(sql`lower(${officeAccounts.loginName}) = lower(${DEVELOPMENT_SAMPLE_LOGINS.office.loginName})`).limit(1);
  const existingBoss = await db.select({ id: bossAccounts.id, studioOfficeAccountId: bossAccounts.studioOfficeAccountId }).from(bossAccounts).where(sql`lower(${bossAccounts.loginName}) = lower(${DEVELOPMENT_SAMPLE_LOGINS.boss.loginName})`).limit(1);
  if (!existingBoss[0]) {
    const credential = await hashPasswordCredential(DEVELOPMENT_SAMPLE_LOGINS.boss.password);
    await db.insert(bossAccounts).values({ loginName: DEVELOPMENT_SAMPLE_LOGINS.boss.loginName, displayName: DEVELOPMENT_SAMPLE_LOGINS.boss.displayName, passwordHash: credential.hash, passwordSalt: credential.salt, studioOfficeAccountId: studioOffice!.id });
  } else if (!existingBoss[0].studioOfficeAccountId && studioOffice) {
    await db.update(bossAccounts).set({ studioOfficeAccountId: studioOffice.id, updatedAt: new Date() }).where(eq(bossAccounts.id, existingBoss[0].id));
  }

  const existingManagerAccess = await db
    .select({ legId: legManagerAccess.legId })
    .from(legManagerAccess)
    .where(eq(legManagerAccess.legId, DEVELOPMENT_SAMPLE_LEG_ID))
    .limit(1);

  if (!existingManagerAccess[0]) {
    const credential = await hashPasswordCredential(
      DEVELOPMENT_SAMPLE_LOGINS.manager.password,
    );
    await db.insert(legManagerAccess).values({
      legId: DEVELOPMENT_SAMPLE_LEG_ID,
      passwordHash: credential.hash,
      passwordSalt: credential.salt,
      managerName: DEVELOPMENT_SAMPLE_LOGINS.manager.legName,
      sessionVersion: 1,
    });
  }
}