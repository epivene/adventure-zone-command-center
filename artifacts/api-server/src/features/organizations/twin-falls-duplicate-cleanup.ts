import { sql } from "drizzle-orm";

import { db } from "@workspace/db";
import { OrganizationConflictError } from "./organization-conflict";
import { prepareOrganizationMergeReferences } from "./organization-merge-reference-preparation";
import { DrizzleOrganizationRepository } from "./organization-repository";
import { prepareSelectedProfileSubsetMerge } from "./profile-subset-merge-guard";

export type TwinFallsDuplicateGroup = {
  survivorId: string;
  survivorNames: readonly string[];
  targetName: string;
  duplicateIds: readonly string[];
  expectedNamesByProfile: Readonly<Record<string, readonly string[]>>;
  expectedLocationsByProfile: Readonly<Record<string, {
    city: string | null;
    region: string | null;
  }>>;
  expectedActRecordIdsByProfile: Readonly<Record<string, readonly string[]>>;
  logoSourceId: string | null;
};

export const TWIN_FALLS_DUPLICATE_GROUPS = [
  {
    survivorId: "b447c83c-6348-4fab-b850-0db7a5576a83",
    survivorNames: ["Twin Falls County Fair"],
    targetName: "Twin Falls County Fair",
    duplicateIds: [
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2",
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1",
    ],
    expectedNamesByProfile: {
      "b447c83c-6348-4fab-b850-0db7a5576a83": ["Twin Falls County Fair"],
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2": [
        "County Fair - Twin Falls (Filer) ID",
      ],
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1": [
        "County Fair- Twin Falls  (Filer) ID",
      ],
    },
    expectedLocationsByProfile: {
      "b447c83c-6348-4fab-b850-0db7a5576a83": { city: "Filer", region: "ID" },
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2": { city: "Filer", region: "ID" },
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1": { city: "Filer", region: "ID" },
    },
    expectedActRecordIdsByProfile: {
      "b447c83c-6348-4fab-b850-0db7a5576a83": [],
      "7e746d1b-a5dd-4c54-8b5e-fce8697f5af2": [
        "8498d62c-5993-4041-af8c-25704c3aabe4",
      ],
      "0498cac2-4c90-46ab-a214-5c9dcf0775d1": [],
    },
    logoSourceId: "0498cac2-4c90-46ab-a214-5c9dcf0775d1",
  },
  {
    survivorId: "8fc7bc14-ce90-4895-8ae0-8d870fb77459",
    survivorNames: [
      "Twin Falls Western Days (Twin Falls)  ID",
      "Twin Falls Western Days (Twin Falls) ID",
    ],
    targetName: "Twin Falls Western Days (Twin Falls) ID",
    duplicateIds: ["aab7b545-d065-441b-98c0-bef04f78f034"],
    expectedNamesByProfile: {
      "8fc7bc14-ce90-4895-8ae0-8d870fb77459": [
        "Twin Falls Western Days (Twin Falls)  ID",
        "Twin Falls Western Days (Twin Falls) ID",
      ],
      "aab7b545-d065-441b-98c0-bef04f78f034": [
        "Twin Falls Western Days (Twin Falls) ID",
      ],
    },
    expectedLocationsByProfile: {
      "8fc7bc14-ce90-4895-8ae0-8d870fb77459": { city: "Twin Falls", region: "ID" },
      "aab7b545-d065-441b-98c0-bef04f78f034": { city: null, region: null },
    },
    expectedActRecordIdsByProfile: {
      "8fc7bc14-ce90-4895-8ae0-8d870fb77459": [
        "df430d7a-d278-46de-81c6-c2e5f121f9cd",
      ],
      "aab7b545-d065-441b-98c0-bef04f78f034": [],
    },
    logoSourceId: null,
  },
] as const satisfies readonly TwinFallsDuplicateGroup[];

export const TWIN_FALLS_APPLICATION_NOTE = {
  organizationId: "b447c83c-6348-4fab-b850-0db7a5576a83",
  subject: "Online application required",
  body: "Desiree confirmed that The Adventure Zone needs to fill out an online application for the Twin Falls County Fair. Keep this requirement with the surviving fair profile; no application link, deadline, or submission confirmation is recorded yet.",
} as const;

export type TwinFallsDuplicateMergeOutcome =
  | "merged"
  | "already_merged"
  | "unsafe";

export type TwinFallsNoteOutcome = "created" | "existing" | "missing";

export interface TwinFallsDuplicateRepository {
  mergeGroup(group: TwinFallsDuplicateGroup): Promise<TwinFallsDuplicateMergeOutcome>;
  ensureNote(input: {
    organizationId: string;
    subject: string;
    body: string;
  }): Promise<TwinFallsNoteOutcome>;
}

export type TwinFallsDuplicateCleanupResult = {
  merged: string[];
  alreadyMerged: string[];
  skipped: Array<{ survivorId: string; reason: "unsafe" }>;
  note: TwinFallsNoteOutcome;
};

type ProfileRow = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  consolidatedIntoId: string | null;
};

type ActLinkRow = {
  entityId: string;
  actRecordId: string;
};

function normalizedLocation(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleUpperCase("en-US") : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const a = [...left].sort((x, y) => x.localeCompare(y, "en-US"));
  const b = [...right].sort((x, y) => x.localeCompare(y, "en-US"));
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function profileMatchesExpectation(
  group: TwinFallsDuplicateGroup,
  profile: ProfileRow,
): boolean {
  const names = group.expectedNamesByProfile[profile.id];
  const location = group.expectedLocationsByProfile[profile.id];
  return Boolean(names?.includes(profile.name))
    && Boolean(location)
    && (profile.city?.trim() || null) === location!.city
    && normalizedLocation(profile.region) === normalizedLocation(location!.region)
    && profile.consolidatedIntoId === null;
}

export async function applyTwinFallsDuplicateCleanup(
  repository: TwinFallsDuplicateRepository = new PostgresTwinFallsDuplicateRepository(),
): Promise<TwinFallsDuplicateCleanupResult> {
  const result: TwinFallsDuplicateCleanupResult = {
    merged: [],
    alreadyMerged: [],
    skipped: [],
    note: "missing",
  };

  for (const group of TWIN_FALLS_DUPLICATE_GROUPS) {
    const outcome = await repository.mergeGroup(group);
    if (outcome === "merged") {
      result.merged.push(...group.duplicateIds);
    } else if (outcome === "already_merged") {
      result.alreadyMerged.push(...group.duplicateIds);
    } else {
      result.skipped.push({ survivorId: group.survivorId, reason: "unsafe" });
    }
  }

  result.note = await repository.ensureNote(TWIN_FALLS_APPLICATION_NOTE);
  return result;
}

export class PostgresTwinFallsDuplicateRepository
implements TwinFallsDuplicateRepository {
  private readonly organizationRepository = new DrizzleOrganizationRepository(db);

  async mergeGroup(
    group: TwinFallsDuplicateGroup,
  ): Promise<TwinFallsDuplicateMergeOutcome> {
    try {
      return await db.transaction(async (transaction) => {
        const allIds = [group.survivorId, ...group.duplicateIds];
        const idList = sql.join(
          allIds.map((id) => sql`${id}::uuid`),
          sql.raw(", "),
        );
        const profileResult = await transaction.execute<ProfileRow>(sql`
          SELECT
            id::text AS id,
            name,
            city,
            region,
            consolidated_into_id::text AS "consolidatedIntoId"
          FROM organizations
          WHERE id IN (${idList})
          ORDER BY id
          FOR UPDATE
        `);
        const byId = new Map(profileResult.rows.map((row) => [row.id, row]));
        const survivor = byId.get(group.survivorId);
        if (!survivor || !profileMatchesExpectation(group, survivor)) return "unsafe";

        const presentDuplicateIds = group.duplicateIds.filter((id) => byId.has(id));
        if (presentDuplicateIds.length === 0) {
          if (survivor.name !== group.targetName) {
            await transaction.execute(sql`
              UPDATE organizations
              SET name = ${group.targetName}, updated_at = now()
              WHERE id = ${group.survivorId}::uuid
                AND consolidated_into_id IS NULL
            `);
          }
          return "already_merged";
        }

        for (const duplicateId of presentDuplicateIds) {
          const profile = byId.get(duplicateId);
          if (!profile || !profileMatchesExpectation(group, profile)) return "unsafe";
        }

        const selectedIds = [group.survivorId, ...presentDuplicateIds];
        const selectedIdList = sql.join(
          selectedIds.map((id) => sql`${id}::uuid`),
          sql.raw(", "),
        );
        const actLinks = await transaction.execute<ActLinkRow>(sql`
          SELECT
            entity_id::text AS "entityId",
            act_record_id AS "actRecordId"
          FROM act_external_links
          WHERE entity_type = 'organization'
            AND entity_id IN (${selectedIdList})
          ORDER BY entity_id, act_record_id
        `);
        for (const profileId of selectedIds) {
          const actual = actLinks.rows
            .filter((link) => link.entityId === profileId)
            .map((link) => link.actRecordId);
          const expected = group.expectedActRecordIdsByProfile[profileId];
          if (!expected || !sameStrings(actual, expected)) return "unsafe";
        }

        if (group.logoSourceId && byId.has(group.logoSourceId)) {
          await transaction.execute(sql`
            UPDATE organizations AS survivor
            SET profile_image_data_url = COALESCE(
                  survivor.profile_image_data_url,
                  source.profile_image_data_url
                ),
                updated_at = CASE
                  WHEN survivor.profile_image_data_url IS NULL
                    AND source.profile_image_data_url IS NOT NULL
                  THEN now()
                  ELSE survivor.updated_at
                END
            FROM organizations AS source
            WHERE survivor.id = ${group.survivorId}::uuid
              AND source.id = ${group.logoSourceId}::uuid
          `);
        }

        await prepareSelectedProfileSubsetMerge(transaction, selectedIds);
        await prepareOrganizationMergeReferences(
          transaction,
          group.survivorId,
          presentDuplicateIds,
        );
        await this.organizationRepository.mergeOrganizations(
          group.survivorId,
          presentDuplicateIds,
          transaction,
        );
        await transaction.execute(sql`
          UPDATE organizations
          SET name = ${group.targetName}, updated_at = now()
          WHERE id = ${group.survivorId}::uuid
            AND consolidated_into_id IS NULL
        `);
        return "merged";
      });
    } catch (error) {
      if (error instanceof OrganizationConflictError) return "unsafe";
      throw error;
    }
  }

  async ensureNote(input: {
    organizationId: string;
    subject: string;
    body: string;
  }): Promise<TwinFallsNoteOutcome> {
    return db.transaction(async (transaction) => {
      const profile = await transaction.execute<{ id: string }>(sql`
        SELECT id::text AS id
        FROM organizations
        WHERE id = ${input.organizationId}::uuid
          AND consolidated_into_id IS NULL
        FOR UPDATE
      `);
      if (!profile.rows[0]) return "missing";

      const existing = await transaction.execute<{ id: string }>(sql`
        SELECT id::text AS id
        FROM activities
        WHERE organization_id = ${input.organizationId}::uuid
          AND kind = 'note'
          AND subject = ${input.subject}
          AND body = ${input.body}
          AND deleted_at IS NULL
        LIMIT 1
      `);
      if (existing.rows[0]) return "existing";

      await transaction.execute(sql`
        INSERT INTO activities (
          id,
          organization_id,
          kind,
          subject,
          body,
          occurred_at,
          timeline_sort_at,
          created_at,
          updated_at
        ) VALUES (
          gen_random_uuid(),
          ${input.organizationId}::uuid,
          'note',
          ${input.subject},
          ${input.body},
          now(),
          now(),
          now(),
          now()
        )
      `);
      return "created";
    });
  }
}
