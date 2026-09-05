import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { bossAccounts } from "@/db/schema";

export class DrizzleBossAccountRepository {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}
  async findByLogin(loginName: string) {
    return (await this.database.select().from(bossAccounts).where(sql`lower(${bossAccounts.loginName}) = lower(${loginName.trim()})`).limit(1))[0] ?? null;
  }
  async getActiveSession(id: string) {
    const account = (await this.database.select().from(bossAccounts).where(eq(bossAccounts.id, id)).limit(1))[0] ?? null;
    return account?.enabled ? account : null;
  }
  async list() { return this.database.select({ id: bossAccounts.id, loginName: bossAccounts.loginName, displayName: bossAccounts.displayName, role: bossAccounts.role, enabled: bossAccounts.enabled, sessionVersion: bossAccounts.sessionVersion, studioOfficeAccountId: bossAccounts.studioOfficeAccountId }).from(bossAccounts).orderBy(asc(bossAccounts.displayName)); }
  async create(input: { loginName: string; displayName: string; passwordHash: string; passwordSalt: string; studioOfficeAccountId: string }) {
    return (await this.database.insert(bossAccounts).values({ ...input, loginName: input.loginName.trim(), displayName: input.displayName.trim() }).returning())[0]!;
  }
  async update(id: string, input: { enabled?: boolean; loginName?: string; displayName?: string; studioOfficeAccountId?: string }) {
    const set: Record<string, unknown> = { updatedAt: new Date(), ...input };
    if (input.loginName) set.loginName = input.loginName.trim();
    if (input.displayName) set.displayName = input.displayName.trim();
    if (input.enabled === false) set.sessionVersion = sql`${bossAccounts.sessionVersion} + 1`;
    return (await this.database.update(bossAccounts).set(set).where(eq(bossAccounts.id, id)).returning())[0] ?? null;
  }
  async setPassword(id: string, passwordHash: string, passwordSalt: string) { return (await this.database.update(bossAccounts).set({ passwordHash, passwordSalt, sessionVersion: sql`${bossAccounts.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(bossAccounts.id, id)).returning())[0] ?? null; }
  async signOutAll(id: string) { return (await this.database.update(bossAccounts).set({ sessionVersion: sql`${bossAccounts.sessionVersion} + 1`, updatedAt: new Date() }).where(eq(bossAccounts.id, id)).returning({ id: bossAccounts.id })).length > 0; }
}