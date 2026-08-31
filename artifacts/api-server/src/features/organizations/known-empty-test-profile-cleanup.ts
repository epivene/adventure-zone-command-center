import { pool as defaultPool } from "@workspace/db";

export {
  KNOWN_BLANK_PROFILE_ENRICHMENTS,
  PostgresKnownBlankProfileEnrichmentRepository,
  enrichKnownBlankProfiles,
  isKnownBlankProfileEnrichmentCompatible,
} from "./known-blank-profile-enrichment";
export type {
  KnownBlankProfileEnrichment,
  KnownBlankProfileEnrichmentApplyOutcome,
  KnownBlankProfileEnrichmentRepository,
  KnownBlankProfileEnrichmentResult,
  KnownBlankProfileSnapshot,
} from "./known-blank-profile-enrichment";

export type KnownEmptyTestProfileCandidate = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  placeType: "other";
};

export const KNOWN_EMPTY_TEST_PROFILES = [
  {
    id: "08e8e9b8-618a-4129-ab14-640345c1abf0",
    name: "Double-Run Fairs",
    city: null,
    region: null,
    placeType: "other",
  },
  {
    id: "b0b9007c-e145-4f72-955e-03a28ef149f4",
    name: "Fair Alpha",
    city: "Peoria",
    region: "IL",
    placeType: "other",
  },
  {
    id: "9fcb2baa-9014-46bc-96be-6009b95d93ba",
    name: "Fair Beta",
    city: "Decatur",
    region: "IL",
    placeType: "other",
  },
  {
    id: "0bfee77c-e42c-417f-9d5e-7df54d57c38b",
    name: "Redirect Canonical",
    city: null,
    region: null,
    placeType: "other",
  },
] as const satisfies readonly KnownEmptyTestProfileCandidate[];

export type KnownEmptyTestProfileInspection = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  actLinkCount: number;
  referenceCount: number;
  profile: Record<string, unknown>;
};

export type KnownEmptyTestProfileDeleteOutcome =
  | "deleted"
  | "missing"
  | "referenced";

export interface KnownEmptyTestProfileRepository {
  inspect(id: string): Promise<KnownEmptyTestProfileInspection | null>;
  remove(
    id: string,
    expectedName: string,
  ): Promise<KnownEmptyTestProfileDeleteOutcome>;
}

export type KnownEmptyTestProfileCleanupSkipReason =
  | "identity_changed"
  | "act_source_present"
  | "linked_records_present"
  | "profile_has_content"
  | "referenced_during_delete";

export type KnownEmptyTestProfileCleanupResult = {
  deleted: string[];
  alreadyAbsent: string[];
  skipped: Array<{
    id: string;
    reason: KnownEmptyTestProfileCleanupSkipReason;
  }>;
};

type QueryResult<Row extends Record<string, unknown>> = {
  rows: Row[];
};

type QueryExecutor = {
  query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<Row>>;
};

type QueryClient = QueryExecutor & {
  release(): void;
};

type QueryPool = QueryExecutor & {
  connect(): Promise<QueryClient>;
};

type ReferenceColumn = {
  schemaName: string;
  tableName: string;
  columnName: string;
};

const PROFILE_CONTENT_KEYS = [
  "phone",
  "normalized_phone",
  "normalizedPhone",
  "email",
  "address_1",
  "address1",
  "address_2",
  "address2",
  "postal_code",
  "postalCode",
  "website",
  "description",
  "last_resort_reason",
  "lastResortReason",
  "last_resort_changed_at",
  "lastResortChangedAt",
  "filler_reason",
  "fillerReason",
  "filler_changed_at",
  "fillerChangedAt",
  "parent_organization_id",
  "parentOrganizationId",
  "consolidated_into_id",
  "consolidatedIntoId",
  "profile_image_data_url",
  "profileImageDataUrl",
  "act_record_id",
  "actRecordId",
] as const;

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizedRegion(value: unknown): string | null {
  return nullableText(value)?.toUpperCase() ?? null;
}

function hasProfileContent(profile: Record<string, unknown>): boolean {
  if (PROFILE_CONTENT_KEYS.some((key) => nullableText(profile[key]))) return true;
  return profile["last_resort"] === true
    || profile["lastResort"] === true
    || profile["filler"] === true;
}

function identityMatches(
  candidate: KnownEmptyTestProfileCandidate,
  inspection: KnownEmptyTestProfileInspection,
): boolean {
  const storedPlaceType = nullableText(
    inspection.profile["place_type"] ?? inspection.profile["placeType"],
  );
  return inspection.id === candidate.id
    && inspection.name.trim() === candidate.name
    && nullableText(inspection.city) === candidate.city
    && normalizedRegion(inspection.region) === candidate.region
    && storedPlaceType === candidate.placeType;
}

export async function cleanupKnownEmptyTestProfiles(
  repository: KnownEmptyTestProfileRepository = new PostgresKnownEmptyTestProfileRepository(),
  candidates: readonly KnownEmptyTestProfileCandidate[] = KNOWN_EMPTY_TEST_PROFILES,
): Promise<KnownEmptyTestProfileCleanupResult> {
  const result: KnownEmptyTestProfileCleanupResult = {
    deleted: [],
    alreadyAbsent: [],
    skipped: [],
  };

  for (const candidate of candidates) {
    const inspection = await repository.inspect(candidate.id);
    if (!inspection) {
      result.alreadyAbsent.push(candidate.id);
      continue;
    }
    if (!identityMatches(candidate, inspection)) {
      result.skipped.push({ id: candidate.id, reason: "identity_changed" });
      continue;
    }
    if (inspection.actLinkCount > 0) {
      result.skipped.push({ id: candidate.id, reason: "act_source_present" });
      continue;
    }
    if (inspection.referenceCount > 0) {
      result.skipped.push({ id: candidate.id, reason: "linked_records_present" });
      continue;
    }
    if (hasProfileContent(inspection.profile)) {
      result.skipped.push({ id: candidate.id, reason: "profile_has_content" });
      continue;
    }

    const outcome = await repository.remove(candidate.id, candidate.name);
    if (outcome === "deleted") {
      result.deleted.push(candidate.id);
    } else if (outcome === "missing") {
      result.alreadyAbsent.push(candidate.id);
    } else {
      result.skipped.push({ id: candidate.id, reason: "referenced_during_delete" });
    }
  }

  return result;
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function postgresCode(error: unknown): string | null {
  if (!error || typeof error !== "object" || !("code" in error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

async function countActLinks(executor: QueryExecutor, id: string): Promise<number> {
  const result = await executor.query<{ count: number | string }>(
    `SELECT count(*)::int AS count
     FROM act_external_links
     WHERE entity_type = 'organization'
       AND entity_id = $1::uuid`,
    [id],
  );
  return Number(result.rows[0]?.count ?? 0);
}

export class PostgresKnownEmptyTestProfileRepository
implements KnownEmptyTestProfileRepository {
  private referenceColumnsPromise: Promise<ReferenceColumn[]> | null = null;

  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}

  async inspect(id: string): Promise<KnownEmptyTestProfileInspection | null> {
    const profileResult = await this.pool.query<{
      id: string;
      name: string;
      city: string | null;
      region: string | null;
      profile: Record<string, unknown>;
    }>(
      `SELECT
         o.id::text AS id,
         o.name,
         o.city,
         o.region,
         to_jsonb(o) AS profile
       FROM organizations o
       WHERE o.id = $1::uuid
       LIMIT 1`,
      [id],
    );
    const row = profileResult.rows[0];
    if (!row) return null;

    const [actLinkCount, referenceCount] = await Promise.all([
      countActLinks(this.pool, id),
      this.countReferences(this.pool, id),
    ]);

    return {
      id: row.id,
      name: row.name,
      city: row.city,
      region: row.region,
      profile: row.profile ?? {},
      actLinkCount,
      referenceCount,
    };
  }

  async remove(
    id: string,
    expectedName: string,
  ): Promise<KnownEmptyTestProfileDeleteOutcome> {
    const candidate = KNOWN_EMPTY_TEST_PROFILES.find(
      (item) => item.id === id && item.name === expectedName,
    );
    if (!candidate) return "referenced";

    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const locked = await client.query<{
        id: string;
        name: string;
        city: string | null;
        region: string | null;
        profile: Record<string, unknown>;
      }>(
        `SELECT
           o.id::text AS id,
           o.name,
           o.city,
           o.region,
           to_jsonb(o) AS profile
         FROM organizations o
         WHERE o.id = $1::uuid
         FOR UPDATE`,
        [id],
      );
      const row = locked.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "missing";
      }

      const inspection: KnownEmptyTestProfileInspection = {
        id: row.id,
        name: row.name,
        city: row.city,
        region: row.region,
        profile: row.profile ?? {},
        actLinkCount: await countActLinks(client, id),
        referenceCount: await this.countReferences(client, id),
      };
      if (
        !identityMatches(candidate, inspection)
        || inspection.actLinkCount > 0
        || inspection.referenceCount > 0
        || hasProfileContent(inspection.profile)
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "referenced";
      }

      const deleted = await client.query<{ id: string }>(
        `DELETE FROM organizations
         WHERE id = $1::uuid AND name = $2
         RETURNING id::text AS id`,
        [id, expectedName],
      );
      if (!deleted.rows.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "missing";
      }
      await client.query("COMMIT");
      transactionStarted = false;
      return "deleted";
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      if (postgresCode(error) === "23503") return "referenced";
      throw error;
    } finally {
      client.release();
    }
  }

  private async countReferences(executor: QueryExecutor, id: string): Promise<number> {
    const references = await this.loadReferenceColumns();
    if (!references.length) return 0;
    const expression = references.map((reference) => {
      const table = `${quoteIdentifier(reference.schemaName)}.${quoteIdentifier(reference.tableName)}`;
      const column = quoteIdentifier(reference.columnName);
      return `(SELECT count(*) FROM ${table} WHERE ${column} = $1::uuid)`;
    }).join(" + ");
    const result = await executor.query<{ count: number | string }>(
      `SELECT (${expression})::int AS count`,
      [id],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  private loadReferenceColumns(): Promise<ReferenceColumn[]> {
    if (!this.referenceColumnsPromise) {
      this.referenceColumnsPromise = this.pool.query<{
        schemaName: string;
        tableName: string;
        columnName: string;
      }>(`
        SELECT DISTINCT
          namespace.nspname AS "schemaName",
          relation.relname AS "tableName",
          source_attribute.attname AS "columnName"
        FROM pg_constraint constraint_record
        INNER JOIN pg_class relation
          ON relation.oid = constraint_record.conrelid
        INNER JOIN pg_namespace namespace
          ON namespace.oid = relation.relnamespace
        INNER JOIN LATERAL unnest(constraint_record.conkey) WITH ORDINALITY source_key(attnum, position)
          ON true
        INNER JOIN LATERAL unnest(constraint_record.confkey) WITH ORDINALITY target_key(attnum, position)
          ON target_key.position = source_key.position
        INNER JOIN pg_attribute source_attribute
          ON source_attribute.attrelid = constraint_record.conrelid
         AND source_attribute.attnum = source_key.attnum
        INNER JOIN pg_attribute target_attribute
          ON target_attribute.attrelid = constraint_record.confrelid
         AND target_attribute.attnum = target_key.attnum
        WHERE constraint_record.contype = 'f'
          AND constraint_record.confrelid = 'organizations'::regclass
          AND target_attribute.attname = 'id'
        ORDER BY namespace.nspname, relation.relname, source_attribute.attname
      `).then((result) => result.rows.map((row) => ({
        schemaName: row.schemaName,
        tableName: row.tableName,
        columnName: row.columnName,
      })));
    }
    return this.referenceColumnsPromise;
  }
}
