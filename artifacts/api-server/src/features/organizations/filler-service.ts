import { sql } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { recordAuditEntry } from "@/features/audit/audit-service";
import type { SetFillerInput } from "@/features/organizations/last-resort-input";

type FillerRow = {
  id: string;
  filler: boolean;
  fillerReason: string | null;
  fillerChangedAt: Date | string | null;
};

type DrizzleDatabase = typeof database;

export async function getOrganizationFiller(
  db: DrizzleDatabase,
  organizationId: string,
): Promise<FillerRow | null> {
  const result = await db.execute<FillerRow>(sql`
    select
      id,
      coalesce(filler, false) as filler,
      filler_reason as "fillerReason",
      filler_changed_at as "fillerChangedAt"
    from organizations
    where id = ${organizationId}::uuid
    limit 1
  `);
  return result.rows?.[0] ?? null;
}

export async function setOrganizationFiller(
  db: Pick<DrizzleDatabase, "transaction">,
  input: SetFillerInput,
  changedAt: Date,
): Promise<boolean> {
  const reason = input.enabled ? input.reason.trim() : null;

  return db.transaction(async (transaction) => {
    const currentResult = await transaction.execute<FillerRow>(sql`
      select
        id,
        coalesce(filler, false) as filler,
        filler_reason as "fillerReason",
        filler_changed_at as "fillerChangedAt"
      from organizations
      where id = ${input.organizationId}::uuid
      for update
    `);
    const current = currentResult.rows?.[0];
    if (!current) return false;

    await transaction.execute(sql`
      update organizations
      set
        filler = ${input.enabled},
        filler_reason = ${reason},
        filler_changed_at = ${changedAt},
        updated_at = ${changedAt}
      where id = ${input.organizationId}::uuid
    `);

    await recordAuditEntry(transaction, {
      entityType: "organization",
      entityId: input.organizationId,
      action: input.enabled ? "filler_enabled" : "filler_cleared",
      before: {
        filler: current.filler,
        fillerReason: current.fillerReason,
        fillerChangedAt: current.fillerChangedAt,
      },
      after: {
        filler: input.enabled,
        fillerReason: reason,
        fillerChangedAt: changedAt,
      },
    });

    return true;
  });
}
