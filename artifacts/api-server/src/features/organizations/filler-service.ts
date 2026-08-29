import { sql } from "drizzle-orm";

import type { db as database } from "../../db/client";
import type { SetFillerInput } from "./last-resort-input";

type FillerRow = {
  id: string;
  filler: boolean;
  fillerReason: string | null;
  fillerChangedAt: Date | string | null;
};

export async function getOrganizationFiller(
  db: typeof database,
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
  db: typeof database,
  input: SetFillerInput,
  now: Date,
): Promise<void> {
  const reason = input.enabled ? input.reason.trim() : null;

  await db.transaction(async (transaction) => {
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
    if (!current) throw new Error("Organization not found");

    await transaction.execute(sql`
      update organizations
      set
        filler = ${input.enabled},
        filler_reason = ${reason},
        filler_changed_at = ${now},
        updated_at = ${now}
      where id = ${input.organizationId}::uuid
    `);

    await transaction.execute(sql`
      insert into audit_entries (entity_type, entity_id, action, before, after)
      values (
        'organization',
        ${input.organizationId}::uuid,
        'organization_filler_changed',
        ${JSON.stringify({ filler: current.filler, fillerReason: current.fillerReason })}::jsonb,
        ${JSON.stringify({ filler: input.enabled, fillerReason: reason })}::jsonb
      )
    `);
  });
}
