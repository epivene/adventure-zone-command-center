import { pool as defaultPool } from "@workspace/db";

export type KnownEmptyTestProfileClusterCandidate = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  placeType: "other";
};

export const KNOWN_EMPTY_TEST_PROFILE_CLUSTERS = [
  {
    id: "08e8e9b8-618a-4129-ab14-640345c1abf0",
    name: "Double-Run Fairs",
    city: null,
    region: null,
    placeType: "other",
  },
  {
    id: "0bfee77c-e42c-417f-9d5e-7df54d57c38b",
    name: "Redirect Canonical",
    city: null,
    region: null,
    placeType: "other",
  },
] as const satisfies readonly KnownEmptyTestProfileClusterCandidate[];

export type KnownEmptyTestProfileClusterCleanupOutcome =
  | "deleted"
  | "missing"
  | "not_cluster"
  | "unsafe";

export interface KnownEmptyTestProfileClusterRepository {
  remove(
    candidate: KnownEmptyTestProfileClusterCandidate,
  ): Promise<KnownEmptyTestProfileClusterCleanupOutcome>;
}

export type KnownEmptyTestProfileClusterCleanupResult = {
  deleted: string[];
  alreadyAbsent: string[];
  skipped: Array<{
    id: string;
    reason: "not_cluster" | "unsafe";
  }>;
};

export type TestClusterOrganization = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  profile: Record<string, unknown>;
};

export type TestClusterReference = {
  schemaName: string;
  tableName: string;
  columnName: string;
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

type ClusterRow = TestClusterOrganization & {
  consolidatedIntoId: string | null;
  parentOrganizationId: string | null;
};

const NON_STRUCTURAL_CONTENT_KEYS = [
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

function booleanTrue(profile: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => profile[key] === true);
}

function profilePointer(
  profile: Record<string, unknown>,
  snakeCase: string,
  camelCase: string,
): string | null {
  return nullableText(profile[snakeCase] ?? profile[camelCase]);
}

export function isBlankTestClusterOrganization(
  organization: TestClusterOrganization,
  expectedConsolidatedIntoId: string | null,
): boolean {
  const profile = organization.profile;
  const placeType = nullableText(profile["place_type"] ?? profile["placeType"]);
  const consolidatedIntoId = profilePointer(
    profile,
    "consolidated_into_id",
    "consolidatedIntoId",
  );
  const parentOrganizationId = profilePointer(
    profile,
    "parent_organization_id",
    "parentOrganizationId",
  );

  if (placeType !== "other") return false;
  if (parentOrganizationId !== null) return false;
  if (consolidatedIntoId !== expectedConsolidatedIntoId) return false;
  if (NON_STRUCTURAL_CONTENT_KEYS.some((key) => nullableText(profile[key]))) return false;
  if (booleanTrue(profile, "last_resort", "lastResort", "filler")) return false;
  return true;
}

export function isAllowedTestClusterReference(
  reference: TestClusterReference,
): boolean {
  if (reference.schemaName !== "public") return false;
  if (
    reference.tableName === "organizations"
    && reference.columnName === "consolidated_into_id"
  ) {
    return true;
  }
  return reference.tableName === "organization_locations"
    && (
      reference.columnName === "organization_id"
      || reference.columnName === "consolidation_source_org_id"
    );
}

export async function cleanupKnownEmptyTestProfileClusters(
  repository: KnownEmptyTestProfileClusterRepository = new PostgresKnownEmptyTestProfileClusterRepository(),
  candidates: readonly KnownEmptyTestProfileClusterCandidate[] = KNOWN_EMPTY_TEST_PROFILE_CLUSTERS,
): Promise<KnownEmptyTestProfileClusterCleanupResult> {
  const result: KnownEmptyTestProfileClusterCleanupResult = {
    deleted: [],
    alreadyAbsent: [],
    skipped: [],
  };

  for (const candidate of candidates) {
    const outcome = await repository.remove(candidate);
    if (outcome === "deleted") {
      result.deleted.push(candidate.id);
    } else if (outcome === "missing") {
      result.alreadyAbsent.push(candidate.id);
    } else {
      result.skipped.push({ id: candidate.id, reason: outcome });
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

function candidateMatches(
  candidate: KnownEmptyTestProfileClusterCandidate,
  row: ClusterRow,
): boolean {
  return row.id === candidate.id
    && row.name === candidate.name
    && nullableText(row.city) === candidate.city
    && normalizedRegion(row.region) === candidate.region
    && isBlankTestClusterOrganization(row, null);
}

export class PostgresKnownEmptyTestProfileClusterRepository
implements KnownEmptyTestProfileClusterRepository {
  private referenceColumnsPromise: Promise<TestClusterReference[]> | null = null;

  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}

  async remove(
    candidate: KnownEmptyTestProfileClusterCandidate,
  ): Promise<KnownEmptyTestProfileClusterCleanupOutcome> {
    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;

      const rootResult = await client.query<ClusterRow>(
        `SELECT
           o.id::text AS id,
           o.name,
           o.city,
           o.region,
           o.consolidated_into_id::text AS "consolidatedIntoId",
           o.parent_organization_id::text AS "parentOrganizationId",
           to_jsonb(o) AS profile
         FROM organizations o
         WHERE o.id = $1::uuid
         FOR UPDATE`,
        [candidate.id],
      );
      const root = rootResult.rows[0];
      if (!root) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "missing";
      }
      if (!candidateMatches(candidate, root)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "unsafe";
      }

      const childResult = await client.query<ClusterRow>(
        `SELECT
           o.id::text AS id,
           o.name,
           o.city,
           o.region,
           o.consolidated_into_id::text AS "consolidatedIntoId",
           o.parent_organization_id::text AS "parentOrganizationId",
           to_jsonb(o) AS profile
         FROM organizations o
         WHERE o.consolidated_into_id = $1::uuid
         ORDER BY o.id
         FOR UPDATE`,
        [candidate.id],
      );
      const children = childResult.rows;
      if (!children.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "not_cluster";
      }
      if (
        children.some((child) =>
          !isBlankTestClusterOrganization(child, candidate.id),
        )
      ) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "unsafe";
      }

      const clusterIds = [candidate.id, ...children.map((child) => child.id)];
      const actLinks = await client.query<{ count: number | string }>(
        `SELECT count(*)::int AS count
         FROM act_external_links
         WHERE entity_type = 'organization'
           AND entity_id = ANY($1::uuid[])`,
        [clusterIds],
      );
      if (Number(actLinks.rows[0]?.count ?? 0) > 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "unsafe";
      }

      const references = await this.loadReferenceColumns();
      for (const reference of references) {
        const table = `${quoteIdentifier(reference.schemaName)}.${quoteIdentifier(reference.tableName)}`;
        const column = quoteIdentifier(reference.columnName);

        if (
          reference.schemaName === "public"
          && reference.tableName === "organizations"
          && reference.columnName === "consolidated_into_id"
        ) {
          const external = await client.query<{ count: number | string }>(
            `SELECT count(*)::int AS count
             FROM ${table}
             WHERE ${column} = ANY($1::uuid[])
               AND NOT (id = ANY($1::uuid[]))`,
            [clusterIds],
          );
          if (Number(external.rows[0]?.count ?? 0) > 0) {
            await client.query("ROLLBACK");
            transactionStarted = false;
            return "unsafe";
          }
          continue;
        }

        if (isAllowedTestClusterReference(reference)) continue;

        const countResult = await client.query<{ count: number | string }>(
          `SELECT count(*)::int AS count
           FROM ${table}
           WHERE ${column} = ANY($1::uuid[])`,
          [clusterIds],
        );
        if (Number(countResult.rows[0]?.count ?? 0) > 0) {
          await client.query("ROLLBACK");
          transactionStarted = false;
          return "unsafe";
        }
      }

      await client.query(
        `DELETE FROM organization_locations
         WHERE organization_id = ANY($1::uuid[])
            OR consolidation_source_org_id = ANY($1::uuid[])`,
        [clusterIds],
      );

      const childIds = children.map((child) => child.id);
      const deletedChildren = await client.query<{ id: string }>(
        `DELETE FROM organizations
         WHERE id = ANY($1::uuid[])
           AND consolidated_into_id = $2::uuid
         RETURNING id::text AS id`,
        [childIds, candidate.id],
      );
      if (deletedChildren.rows.length !== childIds.length) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "unsafe";
      }

      const deletedRoot = await client.query<{ id: string }>(
        `DELETE FROM organizations
         WHERE id = $1::uuid
           AND name = $2
         RETURNING id::text AS id`,
        [candidate.id, candidate.name],
      );
      if (deletedRoot.rows.length !== 1) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "unsafe";
      }

      await client.query("COMMIT");
      transactionStarted = false;
      return "deleted";
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      if (postgresCode(error) === "23503") return "unsafe";
      throw error;
    } finally {
      client.release();
    }
  }

  private loadReferenceColumns(): Promise<TestClusterReference[]> {
    if (!this.referenceColumnsPromise) {
      this.referenceColumnsPromise = this.pool.query<TestClusterReference>(`
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
      `).then((result) => result.rows);
    }
    return this.referenceColumnsPromise;
  }
}
