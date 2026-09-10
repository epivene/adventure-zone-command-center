import { reconcileCapacityFacts } from "@/features/outreach-planner/outreach-commitments";
import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { OrganizationConflictError } from "./organization-conflict";
import { lockOrganizationMutationDomain } from "./organization-family-lock";

type Database = typeof applicationDatabase;

export type RestorableProfileLocation = {
  locationId: string;
  sourceProfileId: string;
  sourceProfileName: string;
  label: string;
  city: string | null;
  region: string | null;
};

type CandidateRow = RestorableProfileLocation & {
  consolidatedIntoId: string | null;
};

type ContactMembershipRow = {
  contactId: string;
  role: string | null;
  active: boolean;
  source: string;
  createdAt: Date;
};

type ScopedNoteRow = {
  id: string;
  body: string;
  createdAt: Date;
  updatedAt: Date;
};

function resultRows<T>(result: unknown): T[] {
  if (!result || typeof result !== "object" || !("rows" in result)) return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? rows as T[] : [];
}

async function candidateRows(
  database: Pick<Database, "execute">,
  canonicalOrgId: string,
  forUpdate = false,
): Promise<CandidateRow[]> {
  const lock = forUpdate ? sql`for update of loc, source` : sql``;
  return resultRows<CandidateRow>(await database.execute(sql`
    select
      loc.id as "locationId",
      source.id as "sourceProfileId",
      source.name as "sourceProfileName",
      source.consolidated_into_id as "consolidatedIntoId",
      loc.label,
      loc.city,
      loc.region
    from organization_locations loc
    inner join organizations source
      on source.id = loc.consolidation_source_org_id
    where loc.organization_id = ${canonicalOrgId}::uuid
      and loc.consolidation_source_org_id is not null
    order by source.name desc, loc.id
    ${lock}
  `));
}

export async function listRestorableProfileLocations(
  database: Database,
  canonicalOrgId: string,
): Promise<RestorableProfileLocation[]> {
  const rows = await candidateRows(database, canonicalOrgId);
  return rows
    .filter((row) => row.consolidatedIntoId === canonicalOrgId)
    .map(({ consolidatedIntoId: _ignored, ...row }) => row);
}

/**
 * Reverse the specific consolidation performed by addProfileAsLocation/applyConsolidation.
 * Only locations carrying consolidation_source_org_id are touched. Manually-created
 * locations remain on the canonical profile.
 */
export async function restoreAllProfileLocations(
  database: Database,
  canonicalOrgId: string,
  now: Date,
): Promise<{ restoredLocationCount: number; restoredProfileIds: string[] }> {
  return reconcileCapacityFacts(database, "canonical-merge",async (tx) => {
    // Use the same mutation domain as consolidation/add-profile flows so a
    // restore cannot race another relationship change and split ownership.
    await lockOrganizationMutationDomain(tx);

    const candidates = await candidateRows(tx as unknown as Database, canonicalOrgId, true);

    if (!candidates.length) {
      return { restoredLocationCount: 0, restoredProfileIds: [] };
    }

    const unsafe = candidates.find((candidate) => candidate.consolidatedIntoId !== canonicalOrgId);
    if (unsafe) {
      throw new OrganizationConflictError(
        `The merged location for ${unsafe.sourceProfileName} cannot be restored safely because its source profile no longer points to this profile.`,
      );
    }

    const canonical = resultRows<{ id: string }>(await tx.execute(sql`
      select id from organizations where id = ${canonicalOrgId}::uuid for update
    `));
    if (!canonical.length) {
      throw new OrganizationConflictError("The parent profile no longer exists.");
    }

    for (const candidate of candidates) {
      const locationId = candidate.locationId;
      const sourceProfileId = candidate.sourceProfileId;

      const memberships = resultRows<ContactMembershipRow>(await tx.execute(sql`
        select
          c.id as "contactId",
          oc.role,
          coalesce(oc.active, true) as active,
          coalesce(oc.source, 'local') as source,
          coalesce(oc.created_at, now()) as "createdAt"
        from contacts c
        left join organization_contacts oc
          on oc.organization_id = ${canonicalOrgId}::uuid
         and oc.contact_id = c.id
        where c.organization_location_id = ${locationId}::uuid
        order by c.id
        for update of c
      `));

      for (const membership of memberships) {
        await tx.execute(sql`
          insert into organization_contacts
            (organization_id, contact_id, role, is_primary, active, source, created_at, updated_at)
          values
            (${sourceProfileId}::uuid, ${membership.contactId}::uuid, ${membership.role}, false,
             ${membership.active}, ${membership.source}, ${membership.createdAt}, ${now})
          on conflict (organization_id, contact_id) do update
          set role = excluded.role,
              active = excluded.active,
              source = excluded.source,
              updated_at = excluded.updated_at
        `);
      }

      await tx.execute(sql`
        update contacts
        set organization_id = ${sourceProfileId}::uuid,
            organization_location_id = null,
            updated_at = ${now}
        where organization_location_id = ${locationId}::uuid
          and organization_id = ${canonicalOrgId}::uuid
      `);

      for (const membership of memberships) {
        await tx.execute(sql`
          delete from organization_contacts
          where organization_id = ${canonicalOrgId}::uuid
            and contact_id = ${membership.contactId}::uuid
        `);
      }

      await tx.execute(sql`
        update organization_contacts
        set is_primary = true,
            updated_at = ${now}
        where id = (
          select candidate.id
          from organization_contacts candidate
          where candidate.organization_id = ${sourceProfileId}::uuid
            and candidate.active = true
          order by candidate.created_at, candidate.contact_id
          limit 1
        )
        and not exists (
          select 1 from organization_contacts existing
          where existing.organization_id = ${sourceProfileId}::uuid
            and existing.active = true
            and existing.is_primary = true
        )
      `);

      await tx.execute(sql`
        update bookings
        set organization_id = ${sourceProfileId}::uuid,
            organization_location_id = null,
            updated_at = ${now}
        where organization_location_id = ${locationId}::uuid
          and organization_id = ${canonicalOrgId}::uuid
      `);
      await tx.execute(sql`
        update activities
        set organization_id = ${sourceProfileId}::uuid,
            organization_location_id = null,
            updated_at = ${now}
        where organization_location_id = ${locationId}::uuid
          and organization_id = ${canonicalOrgId}::uuid
      `);
      await tx.execute(sql`
        update follow_ups
        set organization_id = ${sourceProfileId}::uuid,
            organization_location_id = null,
            updated_at = ${now}
        where organization_location_id = ${locationId}::uuid
          and organization_id = ${canonicalOrgId}::uuid
      `);
      await tx.execute(sql`
        update call_sessions
        set organization_id = ${sourceProfileId}::uuid,
            organization_location_id = null
        where organization_location_id = ${locationId}::uuid
          and organization_id = ${canonicalOrgId}::uuid
      `);

      const notes = resultRows<ScopedNoteRow>(await tx.execute(sql`
        select id, body, created_at as "createdAt", updated_at as "updatedAt"
        from scoped_notes
        where organization_location_id = ${locationId}::uuid
        order by created_at, id
        for update
      `));
      for (const note of notes) {
        await tx.execute(sql`
          insert into activities
            (organization_id, kind, body, occurred_at, timeline_sort_at, created_at, updated_at)
          values
            (${sourceProfileId}::uuid, 'note', ${note.body}, ${note.createdAt}, ${note.createdAt},
             ${note.createdAt}, ${note.updatedAt})
        `);
      }
      await tx.execute(sql`
        delete from scoped_notes where organization_location_id = ${locationId}::uuid
      `);

      await tx.execute(sql`
        update organizations
        set consolidated_into_id = null,
            consolidated_at = null,
            updated_at = ${now}
        where id = ${sourceProfileId}::uuid
          and consolidated_into_id = ${canonicalOrgId}::uuid
      `);

      await tx.execute(sql`
        delete from organization_locations
        where id = ${locationId}::uuid
          and organization_id = ${canonicalOrgId}::uuid
          and consolidation_source_org_id = ${sourceProfileId}::uuid
      `);
    }

    return {
      restoredLocationCount: candidates.length,
      restoredProfileIds: candidates.map((candidate) => candidate.sourceProfileId).sort(),
    };
  });
}
