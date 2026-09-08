import { eq } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { auditEntries, contractSettings } from "@/db/schema";

type Database = typeof database;
const SETTINGS_AUDIT_ID = "00000000-0000-4000-8000-000000000001";

export type ContractSettingsView = {
  internalSignerName: string;
  internalSignerEmail: string | null;
  internalSignerOrder: 2;
  insuranceRecipientName: string;
  insuranceRecipientEmail: string;
  updatedAt: Date;
};

export interface ContractSettingsService {
  get(): Promise<ContractSettingsView>;
  update(input: {
    internalSignerName: string;
    internalSignerEmail: string | null;
    insuranceRecipientName: string;
    insuranceRecipientEmail: string;
    actorId: string;
    now: Date;
  }): Promise<ContractSettingsView>;
}

function view(row: typeof contractSettings.$inferSelect): ContractSettingsView {
  return {
    internalSignerName: row.internalSignerName,
    internalSignerEmail: row.internalSignerEmail,
    internalSignerOrder: 2,
    insuranceRecipientName: row.insuranceRecipientName,
    insuranceRecipientEmail: row.insuranceRecipientEmail,
    updatedAt: row.updatedAt,
  };
}

export class DrizzleContractSettingsService implements ContractSettingsService {
  constructor(private readonly database: Database) {}
  async get() {
    const [row] = await this.database.select().from(contractSettings).where(eq(contractSettings.key, "default")).limit(1);
    if (!row) throw new Error("CONTRACT_SETTINGS_MISSING");
    return view(row);
  }
  async update(input: Parameters<ContractSettingsService["update"]>[0]) {
    return this.database.transaction(async (transaction) => {
      const [before] = await transaction.select().from(contractSettings).where(eq(contractSettings.key, "default")).for("update").limit(1);
      if (!before) throw new Error("CONTRACT_SETTINGS_MISSING");
      const [updated] = await transaction.update(contractSettings).set({
        internalSignerName: input.internalSignerName,
        internalSignerEmail: input.internalSignerEmail,
        internalSignerOrder: 2,
        insuranceRecipientName: input.insuranceRecipientName,
        insuranceRecipientEmail: input.insuranceRecipientEmail,
        updatedBy: input.actorId,
        updatedAt: input.now,
      }).where(eq(contractSettings.key, "default")).returning();
      if (!updated) throw new Error("CONTRACT_SETTINGS_UPDATE_FAILED");
      await transaction.insert(auditEntries).values({
        entityType: "contract_settings",
        entityId: SETTINGS_AUDIT_ID,
        action: "update_contract_settings",
        before: view(before),
        after: { ...view(updated), actorId: input.actorId },
        createdAt: input.now,
      });
      return view(updated);
    });
  }
}
