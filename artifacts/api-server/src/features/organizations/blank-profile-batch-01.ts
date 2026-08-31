import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

import { OrganizationConflictError } from "./organization-conflict";
import { DrizzleOrganizationRepository } from "./organization-repository";

export type BlankProfileBatch01Merge = {
  survivorId: string;
  survivorNames: readonly string[];
  survivorActRecordIds: readonly string[];
  duplicateId: string;
  duplicateNames: readonly string[];
  duplicateActRecordIds: readonly string[];
  allowedDuplicateContactEmails: readonly string[];
};

export type BlankProfileBatch01Rename = {
  id: string;
  expectedNames: readonly string[];
  requiredActRecordId: string;
  targetName: string;
};

export const BLANK_PROFILE_BATCH_01_MERGES = [
  {
    survivorId: "2d29adc2-5482-4d95-9e50-b60d4aae908c",
    survivorNames: [
      "Breckenridge August Art Festivals (Breckenridge)  CO",
      "Breckenridge August Art Festival (Breckenridge) CO",
    ],
    survivorActRecordIds: ["4d8215ac-34cc-4982-96a6-b8ed84ecee6b"],
    duplicateId: "ad4cb1ee-7c19-4afc-9aac-159c8d9270cd",
    duplicateNames: [
      "Breckenridge Main Street Art Festival (Breckenridge)  CO",
      "Breckenridge Main Street Art Festival (Breckenridge) CO",
    ],
    duplicateActRecordIds: ["e26b26cb-982a-4b68-a115-8042cb94db0e"],
    allowedDuplicateContactEmails: [],
  },
  {
    survivorId: "176889d4-b85a-40e9-ae93-f506687f26ff",
    survivorNames: [
      "County Fair - Red River Valley Fair (West Fargo) ND",
      "Red River Valley Fair (West Fargo) ND",
    ],
    survivorActRecordIds: ["dd1d680f-7eb6-4737-a2d6-bfa1c7f6a6f4"],
    duplicateId: "0965cbf6-2396-42b9-89b8-666cd3150cda",
    duplicateNames: ["Red River Valley Fair (West Fargo) ND"],
    duplicateActRecordIds: [],
    allowedDuplicateContactEmails: ["carson@redrivervalleyfair.com"],
  },
] as const satisfies readonly BlankProfileBatch01Merge[];

export const BLANK_PROFILE_BATCH_01_RENAMES = [
  {
    id: "5242da65-1a93-47bb-a48f-31186c22366f",
    expectedNames: [
      "ASSOC - WSAF Washington State Association of Fairs",
      "Washington State Fairs Association",
    ],
    requiredActRecordId: "0b47be7f-9766-4b48-9bdf-afffd47af1a0",
    targetName: "Washington State Fairs Association",
  },
  {
    id: "2d29adc2-5482-4d95-9e50-b60d4aae908c",
    expectedNames: [
      "Breckenridge August Art Festivals (Breckenridge)  CO",
      "Breckenridge August Art Festival (Breckenridge) CO",
    ],
    requiredActRecordId: "4d8215ac-34cc-4982-96a6-b8ed84ecee6b",
    targetName: "Breckenridge August Art Festival (Breckenridge) CO",
  },
  {
    id: "cc388d92-2ee6-44e0-b27b-3a6779d2c026",
    expectedNames: [
      "CAN - County Fair - Medicine Hat Exhibition & Stampede (Medicine Hat) AB",
      "Medicine Hat Exhibition & Stampede (Medicine Hat) AB",
    ],
    requiredActRecordId: "0f366fca-646c-4407-a493-27ca5540aecb",
    targetName: "Medicine Hat Exhibition & Stampede (Medicine Hat) AB",
  },
  {
    id: "ad383aa2-d0fb-49e7-bea4-70416c518aae",
    expectedNames: ["Colorado Brazil Fest () CO", "Colorado Brazil Fest (Boulder) CO"],
    requiredActRecordId: "ae9f6120-c59e-491c-b4ee-15595d4851e4",
    targetName: "Colorado Brazil Fest (Boulder) CO",
  },
  {
    id: "00235299-ce09-4e3f-b8d5-ca3b8d4a1550",
    expectedNames: [
      "County Fair - Deschutes | Bi-Mart Fair & Rodeo (Redmond) OR",
      "Deschutes County Fair & Rodeo (Redmond) OR",
    ],
    requiredActRecordId: "f4a87579-f52a-45c6-ab28-803e341f3b0b",
    targetName: "Deschutes County Fair & Rodeo (Redmond) OR",
  },
  {
    id: "95271417-8cf3-4666-b229-ace086cbf837",
    expectedNames: ["County Fair - Kittitas (Ellensburg) WA", "Kittitas County Fair (Ellensburg) WA"],
    requiredActRecordId: "793ede85-7e48-44f3-92e2-32096a6d5922",
    targetName: "Kittitas County Fair (Ellensburg) WA",
  },
  {
    id: "f33b0771-edfc-4e80-94e5-fd94fefa4ed2",
    expectedNames: ["County Fair - Mineral (Superior) MT", "Mineral County Fair (Superior) MT"],
    requiredActRecordId: "ab1386f1-8e11-4703-b6be-1f0cf439135e",
    targetName: "Mineral County Fair (Superior) MT",
  },
  {
    id: "95338907-699e-479b-9bdf-0d0e432c5ef0",
    expectedNames: ["County Fair - Minidoka (Rupert) ID", "Minidoka County Fair & Rodeo (Rupert) ID"],
    requiredActRecordId: "3daaf085-59ac-4d49-8f1d-2790a8128131",
    targetName: "Minidoka County Fair & Rodeo (Rupert) ID",
  },
  {
    id: "b85f2134-ce79-40e0-84a4-e00a8f4322a9",
    expectedNames: [
      "County Fair - Northwest Washington Fair (Lynden) WA",
      "Northwest Washington Fair (Lynden) WA",
    ],
    requiredActRecordId: "da57034c-1f9d-4d8d-a16b-02908128aba4",
    targetName: "Northwest Washington Fair (Lynden) WA",
  },
  {
    id: "9dd4d699-fb77-4f72-b29c-ed32351b8803",
    expectedNames: ["County Fair - Phillips (Malta) MT", "Phillips County Fair (Dodson) MT"],
    requiredActRecordId: "9e00c2ff-6b12-4e88-8535-89fb7342f7f8",
    targetName: "Phillips County Fair (Dodson) MT",
  },
  {
    id: "e50f361c-aca4-4aa6-b3c5-ef817c647460",
    expectedNames: ["County Fair - Prairie (Terry) MT", "Prairie County Fair (Terry) MT"],
    requiredActRecordId: "c6e5163a-62fa-45a2-89a4-07ef89e344db",
    targetName: "Prairie County Fair (Terry) MT",
  },
  {
    id: "176889d4-b85a-40e9-ae93-f506687f26ff",
    expectedNames: [
      "County Fair - Red River Valley Fair (West Fargo) ND",
      "Red River Valley Fair (West Fargo) ND",
    ],
    requiredActRecordId: "dd1d680f-7eb6-4737-a2d6-bfa1c7f6a6f4",
    targetName: "Red River Valley Fair (West Fargo) ND",
  },
  {
    id: "18f5817e-8767-44ba-b514-baa3197d674f",
    expectedNames: ["County Fair - South Dakota State Fair (Huron) SD", "South Dakota State Fair (Huron) SD"],
    requiredActRecordId: "7343dd9c-26c8-4241-ae6e-da8b9fc5cdd3",
    targetName: "South Dakota State Fair (Huron) SD",
  },
  {
    id: "f86c00a2-1f36-4cd2-8c69-7e58e1a7ff43",
    expectedNames: [
      "County Fair - Stanwood Camano Community Fair (Stanwood) WA",
      "Stanwood-Camano Community Fair (Stanwood) WA",
    ],
    requiredActRecordId: "b6f7754a-848c-4ce0-b8fd-8c5fa9be039a",
    targetName: "Stanwood-Camano Community Fair (Stanwood) WA",
  },
  {
    id: "148e4d3b-71b7-425d-a777-296b2f18ec6d",
    expectedNames: [
      "KOA - West Yellowstone",
      "Yellowstone Park / West Gate KOA Holiday (West Yellowstone) MT",
    ],
    requiredActRecordId: "80fbe263-eacc-4d66-ab5a-9f525d3dff25",
    targetName: "Yellowstone park / West Gate KOA Holiday (West Yellowstone) MT",
  },
  {
    id: "1f6301ab-2c14-41d9-abac-f2b280c2c0f2",
    expectedNames: ["KS Kansas", "Kansas — Territory Placeholder"],
    requiredActRecordId: "a3527021-2d7a-43eb-88aa-0b622ae37544",
    targetName: "Kansas — Territory Placeholder",
  },
  {
    id: "e0761aed-d202-4d98-adb7-9fc70895467b",
    expectedNames: [
      "Legend of Old Ephraim, The (Logan)  UT",
      "Legend of Old Ephraim (Montpelier) ID",
    ],
    requiredActRecordId: "77687bac-8120-4877-8943-c440d720e4cf",
    targetName: "Legend of Old Ephraim (Montpelier) ID",
  },
  {
    id: "90cca325-9d99-4021-8461-236ce364efc1",
    expectedNames: ["Lemonade Day (Berthoud) CO"],
    requiredActRecordId: "20281385-6e66-4eb7-9146-ab6af70bf1db",
    targetName: "Lemonade Day (Berthoud) CO",
  },
  {
    id: "32a6351f-9069-47a8-a1ec-defc6eb5d431",
    expectedNames: ["Lemonade Day (Columbia Falls) MT"],
    requiredActRecordId: "d608114d-455f-4fd9-aba5-b4553098f961",
    targetName: "Lemonade Day (Columbia Falls) MT",
  },
  {
    id: "6bb6d0ac-57ee-40fc-a7b0-08bc7d47cff9",
    expectedNames: ["Lemonade Day (Flathead) MT"],
    requiredActRecordId: "58465ed2-5882-4f75-b10d-d53044f34afc",
    targetName: "Lemonade Day (Flathead) MT",
  },
  {
    id: "471b8fef-e10e-44ef-a39b-2cf00fd61766",
    expectedNames: ["Lemonade Day (Laramie) WY"],
    requiredActRecordId: "b1a2a069-d473-47a7-a8dc-abcf2fbd28ea",
    targetName: "Lemonade Day (Laramie) WY",
  },
  {
    id: "bf3808ff-2585-46fd-ad9a-a90ce32c7460",
    expectedNames: ["Lemonade Day (Treasure Valley) ID"],
    requiredActRecordId: "c1279be6-4714-4d4e-95ea-f2d306912f1f",
    targetName: "Lemonade Day (Treasure Valley) ID",
  },
  {
    id: "83ef3e75-2e33-44f3-ba9d-6423f4c30807",
    expectedNames: ["National Western Stock Show (Denver) CO"],
    requiredActRecordId: "482913ec-bbdd-4598-825f-4cfc2cc3d54b",
    targetName: "National Western Stock Show (Denver) CO",
  },
  {
    id: "b578bb24-f372-4919-984a-ff7a88639c90",
    expectedNames: ["Native American Day (HOLIDAY) MT", "Native American Day (Montana Holiday)"],
    requiredActRecordId: "c3533778-5762-4b31-b2d7-3565f0bbe3cb",
    targetName: "Native American Day (Montana Holiday)",
  },
  {
    id: "6a894884-4722-46b4-8073-93a71d4543a1",
    expectedNames: ["ND North Dakota", "North Dakota — State Placeholder"],
    requiredActRecordId: "9451625d-2e0a-429a-b00f-ca36bc8fbb48",
    targetName: "North Dakota — State Placeholder",
  },
] as const satisfies readonly BlankProfileBatch01Rename[];

export type BlankProfileBatch01MergeOutcome =
  | "merged"
  | "already_merged"
  | "unsafe";

export type BlankProfileBatch01RenameOutcome =
  | "renamed"
  | "already_current"
  | "missing"
  | "unsafe";

export interface BlankProfileBatch01Repository {
  merge(input: BlankProfileBatch01Merge): Promise<BlankProfileBatch01MergeOutcome>;
  rename(input: BlankProfileBatch01Rename): Promise<BlankProfileBatch01RenameOutcome>;
}

export type BlankProfileBatch01Result = {
  merged: string[];
  alreadyMerged: string[];
  renamed: string[];
  alreadyCurrent: string[];
  skipped: Array<{
    id: string;
    operation: "merge" | "rename";
    reason: "unsafe" | "missing" | "merge_not_applied";
  }>;
};

type ProfileRow = {
  id: string;
  name: string;
  consolidatedIntoId: string | null;
};

type ActLinkRow = {
  entityId: string;
  actRecordId: string;
};

function sorted(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right, "en-US"));
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const a = sorted(left);
  const b = sorted(right);
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

export async function applyBlankProfileBatch01(
  repository: BlankProfileBatch01Repository = new PostgresBlankProfileBatch01Repository(),
): Promise<BlankProfileBatch01Result> {
  const result: BlankProfileBatch01Result = {
    merged: [],
    alreadyMerged: [],
    renamed: [],
    alreadyCurrent: [],
    skipped: [],
  };
  const blockedSurvivors = new Set<string>();

  for (const merge of BLANK_PROFILE_BATCH_01_MERGES) {
    const outcome = await repository.merge(merge);
    if (outcome === "merged") {
      result.merged.push(merge.duplicateId);
    } else if (outcome === "already_merged") {
      result.alreadyMerged.push(merge.duplicateId);
    } else {
      blockedSurvivors.add(merge.survivorId);
      result.skipped.push({
        id: merge.duplicateId,
        operation: "merge",
        reason: "unsafe",
      });
    }
  }

  for (const rename of BLANK_PROFILE_BATCH_01_RENAMES) {
    if (blockedSurvivors.has(rename.id)) {
      result.skipped.push({
        id: rename.id,
        operation: "rename",
        reason: "merge_not_applied",
      });
      continue;
    }

    const outcome = await repository.rename(rename);
    if (outcome === "renamed") {
      result.renamed.push(rename.id);
    } else if (outcome === "already_current") {
      result.alreadyCurrent.push(rename.id);
    } else {
      result.skipped.push({
        id: rename.id,
        operation: "rename",
        reason: outcome,
      });
    }
  }

  return result;
}

export class PostgresBlankProfileBatch01Repository
implements BlankProfileBatch01Repository {
  private readonly organizationRepository = new DrizzleOrganizationRepository(db);

  async merge(input: BlankProfileBatch01Merge): Promise<BlankProfileBatch01MergeOutcome> {
    try {
      return await db.transaction(async (transaction) => {
        const profiles = await transaction.execute<ProfileRow>(sql`
          SELECT
            id::text AS id,
            name,
            consolidated_into_id::text AS "consolidatedIntoId"
          FROM organizations
          WHERE id IN (${input.survivorId}::uuid, ${input.duplicateId}::uuid)
          ORDER BY id
          FOR UPDATE
        `);
        const byId = new Map(profiles.rows.map((profile) => [profile.id, profile]));
        const survivor = byId.get(input.survivorId);
        const duplicate = byId.get(input.duplicateId);

        if (!duplicate) return survivor ? "already_merged" : "unsafe";
        if (!survivor) return "unsafe";
        if (survivor.consolidatedIntoId || duplicate.consolidatedIntoId) return "unsafe";
        if (!input.survivorNames.includes(survivor.name)) return "unsafe";
        if (!input.duplicateNames.includes(duplicate.name)) return "unsafe";

        const actLinks = await transaction.execute<ActLinkRow>(sql`
          SELECT entity_id::text AS "entityId", act_record_id AS "actRecordId"
          FROM act_external_links
          WHERE entity_type = 'organization'
            AND entity_id IN (${input.survivorId}::uuid, ${input.duplicateId}::uuid)
          ORDER BY entity_id, act_record_id
        `);
        const survivorActRecords = actLinks.rows
          .filter((link) => link.entityId === input.survivorId)
          .map((link) => link.actRecordId);
        const duplicateActRecords = actLinks.rows
          .filter((link) => link.entityId === input.duplicateId)
          .map((link) => link.actRecordId);
        if (!sameStrings(survivorActRecords, input.survivorActRecordIds)) return "unsafe";
        if (!sameStrings(duplicateActRecords, input.duplicateActRecordIds)) return "unsafe";

        const contactRows = await transaction.execute<{ email: string }>(sql`
          SELECT lower(trim(coalesce(contact.email, ''))) AS email
          FROM organization_contacts relationship
          INNER JOIN contacts contact ON contact.id = relationship.contact_id
          WHERE relationship.organization_id = ${input.duplicateId}::uuid
          ORDER BY lower(trim(coalesce(contact.email, ''))), contact.id
        `);
        if (!sameStrings(
          contactRows.rows.map((contact) => contact.email),
          input.allowedDuplicateContactEmails,
        )) {
          return "unsafe";
        }

        const operational = await transaction.execute<{
          bookingCount: number | string;
          activityCount: number | string;
          followUpCount: number | string;
          callCount: number | string;
        }>(sql`
          SELECT
            (SELECT count(*)::int FROM bookings WHERE organization_id = ${input.duplicateId}::uuid) AS "bookingCount",
            (SELECT count(*)::int FROM activities WHERE organization_id = ${input.duplicateId}::uuid) AS "activityCount",
            (SELECT count(*)::int FROM follow_ups WHERE organization_id = ${input.duplicateId}::uuid) AS "followUpCount",
            (SELECT count(*)::int FROM call_sessions WHERE organization_id = ${input.duplicateId}::uuid) AS "callCount"
        `);
        const counts = operational.rows[0];
        if (!counts) return "unsafe";
        if (
          Number(counts.bookingCount) > 0
          || Number(counts.activityCount) > 0
          || Number(counts.followUpCount) > 0
          || Number(counts.callCount) > 0
        ) {
          return "unsafe";
        }

        await this.organizationRepository.mergeOrganizations(
          input.survivorId,
          [input.duplicateId],
          transaction,
        );
        return "merged";
      });
    } catch (error) {
      if (error instanceof OrganizationConflictError) return "unsafe";
      throw error;
    }
  }

  async rename(input: BlankProfileBatch01Rename): Promise<BlankProfileBatch01RenameOutcome> {
    return db.transaction(async (transaction) => {
      const profiles = await transaction.execute<ProfileRow>(sql`
        SELECT
          id::text AS id,
          name,
          consolidated_into_id::text AS "consolidatedIntoId"
        FROM organizations
        WHERE id = ${input.id}::uuid
        FOR UPDATE
      `);
      const profile = profiles.rows[0];
      if (!profile) return "missing";
      if (profile.consolidatedIntoId) return "unsafe";
      if (profile.name === input.targetName) return "already_current";
      if (!input.expectedNames.includes(profile.name)) return "unsafe";

      const links = await transaction.execute<{ actRecordId: string }>(sql`
        SELECT act_record_id AS "actRecordId"
        FROM act_external_links
        WHERE entity_type = 'organization'
          AND entity_id = ${input.id}::uuid
        ORDER BY act_record_id
      `);
      if (!links.rows.some((link) => link.actRecordId === input.requiredActRecordId)) {
        return "unsafe";
      }

      const updated = await transaction.execute<{ id: string }>(sql`
        UPDATE organizations
        SET name = ${input.targetName}, updated_at = now()
        WHERE id = ${input.id}::uuid
          AND consolidated_into_id IS NULL
        RETURNING id::text AS id
      `);
      return updated.rows.length === 1 ? "renamed" : "unsafe";
    });
  }
}
