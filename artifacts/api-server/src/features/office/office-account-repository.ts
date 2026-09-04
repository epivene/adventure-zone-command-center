import { asc, eq, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { officeAccounts } from "@/db/schema";

export type OfficeAccountCredentialRecord = {
  id: string;
  loginName: string;
  displayName: string;
  role: "office_coordinator";
  passwordHash: string;
  passwordSalt: string;
  enabled: boolean;
  canReviewWebsiteInquiries: boolean;
  sessionVersion: number;
};

export type OfficeAccountSessionRecord = Omit<OfficeAccountCredentialRecord, "passwordHash" | "passwordSalt">;

export class DrizzleOfficeAccountRepository {
  constructor(private readonly database: NodePgDatabase<typeof schema>) {}

  async findByLogin(loginName: string): Promise<OfficeAccountCredentialRecord | null> {
    const rows = await this.database
      .select({
        id: officeAccounts.id,
        loginName: officeAccounts.loginName,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        passwordHash: officeAccounts.passwordHash,
        passwordSalt: officeAccounts.passwordSalt,
        enabled: officeAccounts.enabled,
        canReviewWebsiteInquiries: officeAccounts.canReviewWebsiteInquiries,
        sessionVersion: officeAccounts.sessionVersion,
      })
      .from(officeAccounts)
      .where(sql`lower(${officeAccounts.loginName}) = lower(${loginName.trim()})`)
      .limit(1);
    return rows[0] ?? null;
  }

  async getActiveSession(accountId: string): Promise<OfficeAccountSessionRecord | null> {
    const rows = await this.database
      .select({
        id: officeAccounts.id,
        loginName: officeAccounts.loginName,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        enabled: officeAccounts.enabled,
        canReviewWebsiteInquiries: officeAccounts.canReviewWebsiteInquiries,
        sessionVersion: officeAccounts.sessionVersion,
      })
      .from(officeAccounts)
      .where(eq(officeAccounts.id, accountId))
      .limit(1);
    const account = rows[0] ?? null;
    return account?.enabled ? account : null;
  }

  async listAdmin(): Promise<OfficeAccountSessionRecord[]> {
    return this.database
      .select({
        id: officeAccounts.id,
        loginName: officeAccounts.loginName,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        enabled: officeAccounts.enabled,
        canReviewWebsiteInquiries: officeAccounts.canReviewWebsiteInquiries,
        sessionVersion: officeAccounts.sessionVersion,
      })
      .from(officeAccounts)
      .orderBy(asc(officeAccounts.displayName), asc(officeAccounts.loginName));
  }

  async createAccount(input: {
    loginName: string;
    displayName: string;
    passwordHash: string;
    passwordSalt: string;
    canReviewWebsiteInquiries?: boolean;
  }): Promise<OfficeAccountSessionRecord> {
    const [created] = await this.database
      .insert(officeAccounts)
      .values({
        loginName: input.loginName.trim(),
        displayName: input.displayName.trim(),
        role: "office_coordinator",
        passwordHash: input.passwordHash,
        passwordSalt: input.passwordSalt,
        enabled: true,
        canReviewWebsiteInquiries: input.canReviewWebsiteInquiries ?? false,
        sessionVersion: 1,
      })
      .returning({
        id: officeAccounts.id,
        loginName: officeAccounts.loginName,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        enabled: officeAccounts.enabled,
        canReviewWebsiteInquiries: officeAccounts.canReviewWebsiteInquiries,
        sessionVersion: officeAccounts.sessionVersion,
      });
    if (!created) throw new Error("Office account could not be created.");
    return created;
  }

  async updateAccount(accountId: string, input: {
    loginName?: string;
    displayName?: string;
    enabled?: boolean;
    canReviewWebsiteInquiries?: boolean;
  }): Promise<OfficeAccountSessionRecord | null> {
    const set: Record<string, unknown> = { updatedAt: new Date() };
    if (input.loginName !== undefined) set.loginName = input.loginName.trim();
    if (input.displayName !== undefined) set.displayName = input.displayName.trim();
    if (input.enabled !== undefined) {
      set.enabled = input.enabled;
      if (!input.enabled) set.sessionVersion = sql`${officeAccounts.sessionVersion} + 1`;
    }
    if (input.canReviewWebsiteInquiries !== undefined) {
      set.canReviewWebsiteInquiries = input.canReviewWebsiteInquiries;
      set.sessionVersion = sql`${officeAccounts.sessionVersion} + 1`;
    }
    const [updated] = await this.database
      .update(officeAccounts)
      .set(set)
      .where(eq(officeAccounts.id, accountId))
      .returning({
        id: officeAccounts.id,
        loginName: officeAccounts.loginName,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        enabled: officeAccounts.enabled,
        canReviewWebsiteInquiries: officeAccounts.canReviewWebsiteInquiries,
        sessionVersion: officeAccounts.sessionVersion,
      });
    return updated ?? null;
  }

  async setPassword(accountId: string, passwordHash: string, passwordSalt: string): Promise<OfficeAccountSessionRecord | null> {
    const [updated] = await this.database
      .update(officeAccounts)
      .set({
        passwordHash,
        passwordSalt,
        sessionVersion: sql`${officeAccounts.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(officeAccounts.id, accountId))
      .returning({
        id: officeAccounts.id,
        loginName: officeAccounts.loginName,
        displayName: officeAccounts.displayName,
        role: officeAccounts.role,
        enabled: officeAccounts.enabled,
        canReviewWebsiteInquiries: officeAccounts.canReviewWebsiteInquiries,
        sessionVersion: officeAccounts.sessionVersion,
      });
    return updated ?? null;
  }

  async incrementSessionVersion(accountId: string): Promise<boolean> {
    const rows = await this.database
      .update(officeAccounts)
      .set({ sessionVersion: sql`${officeAccounts.sessionVersion} + 1`, updatedAt: new Date() })
      .where(eq(officeAccounts.id, accountId))
      .returning({ id: officeAccounts.id });
    return rows.length > 0;
  }
}
