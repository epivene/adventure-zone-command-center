import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type BlankProfileBatch02Rename = {
  id: string;
  expectedNames: readonly string[];
  requiredActRecordId: string;
  targetName: string;
};

export const BLANK_PROFILE_BATCH_02_RENAMES = [
  {
    id: "4723cd8b-52aa-4534-834a-3d2082626abe",
    expectedNames: [
      "NE Nebraska",
      "Northeast Nebraska — Unresolved ACT Lead",
    ],
    requiredActRecordId: "897dbf7e-98d7-4d29-880b-107a90ecbf5a",
    targetName: "Northeast Nebraska — Unresolved ACT Lead",
  },
  {
    id: "53d622f0-b3df-495a-a56c-68f6ac7e20b3",
    expectedNames: [
      "Pikes Peak Birding & Nature Fesitval (Colorado Springs) CO",
      "Pikes Peak Birding & Nature Festival (Colorado Springs) CO",
    ],
    requiredActRecordId: "680720d4-8ded-4059-8c84-fbb223529db7",
    targetName: "Pikes Peak Birding & Nature Festival (Colorado Springs) CO",
  },
  {
    id: "025c73a4-1d99-4a93-bc61-10e0c336e178",
    expectedNames: [
      "Rocky Mountain Rambler 500",
      "Rocky Mountain Rambler 500 (Cripple Creek) CO",
    ],
    requiredActRecordId: "472d4ea0-302a-4b0b-9ac4-37c22574c3c7",
    targetName: "Rocky Mountain Rambler 500 (Cripple Creek) CO",
  },
  {
    id: "5fc9a416-6da5-415e-a723-3b328fa020ae",
    expectedNames: [
      "San Juan Southern Paiute Tribe AZ",
      "San Juan Southern Paiute Tribe (Tuba City) AZ",
    ],
    requiredActRecordId: "b988d053-ecbb-41f3-b711-29a3186c6d49",
    targetName: "San Juan Southern Paiute Tribe (Tuba City) AZ",
  },
  {
    id: "42e4d2f4-d72d-4176-843c-cb4a1282defd",
    expectedNames: [
      "Denver Food & Wine Festival (Denver) CO",
      "Denver Food + Wine Festival (Denver) CO",
    ],
    requiredActRecordId: "2233a224-4bac-4b6c-818a-0a048516c390",
    targetName: "Denver Food + Wine Festival (Denver) CO",
  },
  {
    id: "5527509f-a08c-4519-a8a2-66c6fa5825e1",
    expectedNames: [
      "No Barriers - Summit  (Estes Park) CO",
      "No Barriers USA",
    ],
    requiredActRecordId: "2e1e77fd-a189-4720-8b51-016c2909998b",
    targetName: "No Barriers USA",
  },
  {
    id: "065416a5-70cd-4937-ad28-844712434cbc",
    expectedNames: [
      "Orofino All American Fireworks Celebrations (Orofino)  ID",
      "Orofino All American Fireworks Celebration (Orofino) ID",
    ],
    requiredActRecordId: "a553dc55-d855-4255-8902-6e068b8dc708",
    targetName: "Orofino All American Fireworks Celebration (Orofino) ID",
  },
  {
    id: "1a3c59e3-7828-4158-9411-7834c1eb6b2d",
    expectedNames: [
      "4th of July Celebrating the 4th (Alamosa) CO",
      "4th of July Parade & Park Party for America (Alamosa) CO",
    ],
    requiredActRecordId: "fd1f6612-e263-4ace-b66b-d1e0cfce64e3",
    targetName: "4th of July Parade & Park Party for America (Alamosa) CO",
  },
  {
    id: "b989ec78-adb7-4e32-b0e4-a177639b33bd",
    expectedNames: [
      "Kahler Memorial Golf Tournament (Alamosa) CO",
      "Alex P. Kahler Memorial Golf Tournament (Alamosa) CO",
    ],
    requiredActRecordId: "0d508d3e-04d7-4b64-9c7a-d4dea8addf24",
    targetName: "Alex P. Kahler Memorial Golf Tournament (Alamosa) CO",
  },
  {
    id: "b1943bf0-a264-462e-bc3f-3833978348c4",
    expectedNames: [
      "National Park Celebration, A (Alamosa)  CO",
      "We Love Our National Park — Visit Alamosa",
    ],
    requiredActRecordId: "3281f25b-4cd6-48f1-bd8c-05aea98f4de7",
    targetName: "We Love Our National Park — Visit Alamosa",
  },
  {
    id: "4d060525-062b-4e1c-83b5-057b84ef9c95",
    expectedNames: [
      "Food & Wine Classic (Aspen) CO",
      "Food & Wine Classic in Aspen (Aspen) CO",
    ],
    requiredActRecordId: "e40f7616-fd08-42d1-86a6-f15aca69d0d3",
    targetName: "Food & Wine Classic in Aspen (Aspen) CO",
  },
  {
    id: "9d4ae48e-abfd-4297-8e3e-30a7327c3cd1",
    expectedNames: [
      "Quilt, Craft & Sewing Festival (Aurora) CO",
      "Quilt, Craft & Sewing Festival (Castle Rock) CO",
    ],
    requiredActRecordId: "e9bfae78-e3ac-4d51-8a13-a77edaac0dfc",
    targetName: "Quilt, Craft & Sewing Festival (Castle Rock) CO",
  },
  {
    id: "b570449b-e589-4bce-9690-26a7d734d37d",
    expectedNames: [
      "June Jubilee (CO Springs) CO",
      "June Jubilee (Colorado Springs) CO",
    ],
    requiredActRecordId: "76a825bf-378c-4719-aed0-ea7294bfe2f2",
    targetName: "June Jubilee (Colorado Springs) CO",
  },
  {
    id: "b024a26d-eb1a-4c4b-b134-2ee1e309c5c2",
    expectedNames: [
      "Breckenridge Beer Festival (Breckenridge) CO",
      "Breckenridge Summer Beer Festival (Breckenridge) CO",
    ],
    requiredActRecordId: "6b3c63bb-12b2-4583-8eaa-e4a8acdf067a",
    targetName: "Breckenridge Summer Beer Festival (Breckenridge) CO",
  },
  {
    id: "85f40144-40dd-45c4-a975-887e4b94b5ed",
    expectedNames: [
      "Breckenridge International Festival of the Arts (Breckenridge)  CO",
      "Breckenridge International Festival of the Arts (Breckenridge) CO",
    ],
    requiredActRecordId: "d4c58849-0d2d-49d5-960d-95af349cd554",
    targetName: "Breckenridge International Festival of the Arts (Breckenridge) CO",
  },
  {
    id: "9e1d19c6-565d-40f6-8f96-e5434d0ce4fc",
    expectedNames: [
      "Tough Mudder (Byers) CO",
      "Tough Mudder Colorado (Fort Carson) CO",
    ],
    requiredActRecordId: "a79ea7fc-0672-4d4c-b341-92d800cef414",
    targetName: "Tough Mudder Colorado (Fort Carson) CO",
  },
] as const satisfies readonly BlankProfileBatch02Rename[];

export type BlankProfileBatch02RenameOutcome =
  | "renamed"
  | "already_current"
  | "missing"
  | "unsafe";

export interface BlankProfileBatch02Repository {
  rename(input: BlankProfileBatch02Rename): Promise<BlankProfileBatch02RenameOutcome>;
}

export type BlankProfileBatch02Result = {
  renamed: string[];
  alreadyCurrent: string[];
  skipped: Array<{ id: string; reason: "missing" | "unsafe" }>;
};

type ProfileRow = {
  id: string;
  name: string;
  consolidatedIntoId: string | null;
};

export async function applyBlankProfileBatch02(
  repository: BlankProfileBatch02Repository = new PostgresBlankProfileBatch02Repository(),
): Promise<BlankProfileBatch02Result> {
  const result: BlankProfileBatch02Result = {
    renamed: [],
    alreadyCurrent: [],
    skipped: [],
  };

  for (const rename of BLANK_PROFILE_BATCH_02_RENAMES) {
    const outcome = await repository.rename(rename);
    if (outcome === "renamed") result.renamed.push(rename.id);
    else if (outcome === "already_current") result.alreadyCurrent.push(rename.id);
    else result.skipped.push({ id: rename.id, reason: outcome });
  }

  return result;
}

export class PostgresBlankProfileBatch02Repository
implements BlankProfileBatch02Repository {
  async rename(input: BlankProfileBatch02Rename): Promise<BlankProfileBatch02RenameOutcome> {
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

      if (profile.name === input.targetName) return "already_current";

      const updated = await transaction.execute<{ id: string }>(sql`
        UPDATE organizations
        SET name = ${input.targetName}, updated_at = now()
        WHERE id = ${input.id}::uuid
          AND name = ${profile.name}
          AND consolidated_into_id IS NULL
        RETURNING id::text AS id
      `);
      return updated.rows.length === 1 ? "renamed" : "unsafe";
    });
  }
}
