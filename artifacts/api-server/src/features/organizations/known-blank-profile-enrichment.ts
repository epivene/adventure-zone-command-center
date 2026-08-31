import { pool as defaultPool } from "@workspace/db";

export type KnownBlankProfileEnrichment = {
  id: string;
  expectedNames: readonly string[];
  expectedPlaceTypes: readonly string[];
  expectedWebsites: readonly string[];
  name: string;
  city: string;
  region: string;
  placeType: "association" | "company" | "other" | "tribe";
  phone: string;
  normalizedPhone: string;
  website: string;
  address1: string;
  postalCode: string;
  description: string;
};

export const KNOWN_BLANK_PROFILE_ENRICHMENTS = [
  {
    id: "7fff8f6c-5e88-46ad-9f00-d1a853040a42",
    expectedNames: ["Colorado events", "Colorado Events"],
    expectedPlaceTypes: ["other", "company"],
    expectedWebsites: ["https://www.coloradoevents.org/"],
    name: "Colorado Events",
    city: "Boulder",
    region: "CO",
    placeType: "company",
    phone: "720-272-7467",
    normalizedPhone: "7202727467",
    website: "https://www.coloradoevents.org/",
    address1: "2525 Arapahoe Avenue, Suite E4-720",
    postalCode: "80302",
    description:
      "Colorado event-production organization. Adventure Zone has an existing Gmail relationship with the producer; individual festivals should be tracked as event appearances or child event records rather than duplicate producer profiles.",
  },
  {
    id: "9c6b750d-828a-4b97-b6aa-0a19c22f18cf",
    expectedNames: ["Idaho Fish and Game", "Idaho Department of Fish and Game"],
    expectedPlaceTypes: ["other"],
    expectedWebsites: [
      "https://idfg.idaho.gov/offices",
      "https://idfg.idaho.gov/",
    ],
    name: "Idaho Department of Fish and Game",
    city: "Boise",
    region: "ID",
    placeType: "other",
    phone: "208-334-3700",
    normalizedPhone: "2083343700",
    website: "https://idfg.idaho.gov/",
    address1: "600 S. Walnut Street",
    postalCode: "83712",
    description:
      "Statewide wildlife agency umbrella profile. Identify and attach a specific public, family, education, or outdoor event—and verify its organizer—before any Adventure Zone outreach.",
  },
  {
    id: "e7ba291f-5d7c-48ec-9c66-7756196ee290",
    expectedNames: [
      "Te Moak Tribe of Western Shoshone",
      "Te-Moak Tribe of Western Shoshone",
      "Te-Moak Tribe of Western Shoshone Indians of Nevada",
    ],
    expectedPlaceTypes: ["other", "tribe"],
    expectedWebsites: ["https://www.temoaktribe.com/"],
    name: "Te-Moak Tribe of Western Shoshone",
    city: "Elko",
    region: "NV",
    placeType: "tribe",
    phone: "775-738-9251",
    normalizedPhone: "7757389251",
    website: "https://www.temoaktribe.com/",
    address1: "525 Sunset Street",
    postalCode: "89801",
    description:
      "Umbrella tribal profile for the Battle Mountain, Elko, South Fork, and Wells bands. Identify the specific band and public event decision-maker before Adventure Zone outreach.",
  },
] as const satisfies readonly KnownBlankProfileEnrichment[];

export type KnownBlankProfileSnapshot = {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  placeType: string | null;
  phone: string | null;
  normalizedPhone: string | null;
  website: string | null;
  address1: string | null;
  postalCode: string | null;
  description: string | null;
  consolidatedIntoId: string | null;
};

export type KnownBlankProfileEnrichmentApplyOutcome =
  | "updated"
  | "already_current"
  | "missing"
  | "identity_changed"
  | "act_source_present";

export interface KnownBlankProfileEnrichmentRepository {
  apply(input: KnownBlankProfileEnrichment): Promise<KnownBlankProfileEnrichmentApplyOutcome>;
}

export type KnownBlankProfileEnrichmentResult = {
  updated: string[];
  alreadyCurrent: string[];
  skipped: Array<{
    id: string;
    reason: Exclude<
      KnownBlankProfileEnrichmentApplyOutcome,
      "updated" | "already_current"
    >;
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

function nullableText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizedRegion(value: unknown): string | null {
  return nullableText(value)?.toUpperCase() ?? null;
}

function normalizedIdentity(value: unknown): string {
  return nullableText(value)?.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() ?? "";
}

function compatibleTargetValue(current: unknown, target: string): boolean {
  const existing = nullableText(current);
  return existing === null || existing === target;
}

function compatibleAllowedValue(
  current: unknown,
  allowedValues: readonly string[],
): boolean {
  const existing = nullableText(current);
  return existing === null || allowedValues.includes(existing);
}

export function isKnownBlankProfileEnrichmentCompatible(
  input: KnownBlankProfileEnrichment,
  row: KnownBlankProfileSnapshot,
): boolean {
  const allowedNames = new Set(input.expectedNames.map(normalizedIdentity));
  return row.id === input.id
    && !row.consolidatedIntoId
    && allowedNames.has(normalizedIdentity(row.name))
    && compatibleTargetValue(row.city, input.city)
    && (normalizedRegion(row.region) === null || normalizedRegion(row.region) === input.region)
    && compatibleAllowedValue(row.placeType, input.expectedPlaceTypes)
    && compatibleTargetValue(row.phone, input.phone)
    && compatibleTargetValue(row.normalizedPhone, input.normalizedPhone)
    && compatibleAllowedValue(row.website, input.expectedWebsites)
    && compatibleTargetValue(row.address1, input.address1)
    && compatibleTargetValue(row.postalCode, input.postalCode)
    && compatibleTargetValue(row.description, input.description);
}

function enrichmentIsCurrent(
  input: KnownBlankProfileEnrichment,
  row: KnownBlankProfileSnapshot,
): boolean {
  return row.name === input.name
    && row.city === input.city
    && normalizedRegion(row.region) === input.region
    && row.placeType === input.placeType
    && row.phone === input.phone
    && row.normalizedPhone === input.normalizedPhone
    && row.website === input.website
    && row.address1 === input.address1
    && row.postalCode === input.postalCode
    && row.description === input.description
    && !row.consolidatedIntoId;
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

export async function enrichKnownBlankProfiles(
  repository: KnownBlankProfileEnrichmentRepository = new PostgresKnownBlankProfileEnrichmentRepository(),
  profiles: readonly KnownBlankProfileEnrichment[] = KNOWN_BLANK_PROFILE_ENRICHMENTS,
): Promise<KnownBlankProfileEnrichmentResult> {
  const result: KnownBlankProfileEnrichmentResult = {
    updated: [],
    alreadyCurrent: [],
    skipped: [],
  };

  for (const profile of profiles) {
    const outcome = await repository.apply(profile);
    if (outcome === "updated") {
      result.updated.push(profile.id);
    } else if (outcome === "already_current") {
      result.alreadyCurrent.push(profile.id);
    } else {
      result.skipped.push({ id: profile.id, reason: outcome });
    }
  }

  return result;
}

export class PostgresKnownBlankProfileEnrichmentRepository
implements KnownBlankProfileEnrichmentRepository {
  private descriptionSchemaPromise: Promise<void> | null = null;

  constructor(private readonly pool: QueryPool = defaultPool as unknown as QueryPool) {}

  async apply(
    input: KnownBlankProfileEnrichment,
  ): Promise<KnownBlankProfileEnrichmentApplyOutcome> {
    await this.ensureDescriptionSchema();

    const client = await this.pool.connect();
    let transactionStarted = false;
    try {
      await client.query("BEGIN");
      transactionStarted = true;
      const profileResult = await client.query<KnownBlankProfileSnapshot>(
        `SELECT
           o.id::text AS id,
           o.name,
           o.city,
           o.region,
           o.place_type AS "placeType",
           o.phone,
           o.normalized_phone AS "normalizedPhone",
           o.website,
           o.address_1 AS "address1",
           o.postal_code AS "postalCode",
           o.description,
           o.consolidated_into_id::text AS "consolidatedIntoId"
         FROM organizations o
         WHERE o.id = $1::uuid
         FOR UPDATE`,
        [input.id],
      );
      const row = profileResult.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "missing";
      }
      if (!isKnownBlankProfileEnrichmentCompatible(input, row)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "identity_changed";
      }
      if (await countActLinks(client, input.id) > 0) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "act_source_present";
      }
      if (enrichmentIsCurrent(input, row)) {
        await client.query("ROLLBACK");
        transactionStarted = false;
        return "already_current";
      }

      await client.query(
        `UPDATE organizations
         SET name = $2,
             city = $3,
             region = $4,
             place_type = $5,
             phone = $6,
             normalized_phone = $7,
             website = $8,
             address_1 = $9,
             postal_code = $10,
             description = $11,
             updated_at = now()
         WHERE id = $1::uuid`,
        [
          input.id,
          input.name,
          input.city,
          input.region,
          input.placeType,
          input.phone,
          input.normalizedPhone,
          input.website,
          input.address1,
          input.postalCode,
          input.description,
        ],
      );
      await client.query("COMMIT");
      transactionStarted = false;
      return "updated";
    } catch (error) {
      if (transactionStarted) await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private ensureDescriptionSchema(): Promise<void> {
    if (!this.descriptionSchemaPromise) {
      this.descriptionSchemaPromise = this.pool
        .query("ALTER TABLE organizations ADD COLUMN IF NOT EXISTS description text")
        .then(() => undefined);
    }
    return this.descriptionSchemaPromise;
  }
}
