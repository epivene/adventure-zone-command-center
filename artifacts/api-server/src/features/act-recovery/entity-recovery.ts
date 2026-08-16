import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";
import { normalizeNorthAmericanPhone } from "@/features/contacts/phone-normalization";
import { normalizeCompany, type Company } from "@/features/act-replacement/normalizers/company-normalizer";
import { normalizeContact, type Contact } from "@/features/act-replacement/normalizers/contact-normalizer";
import type { RecoveryCandidate, RecoveryTerminalState } from "./recovery-types";
import { ActRecoverySourceLinkResolver } from "./source-link-resolver";

type DrizzleDatabase = typeof applicationDatabase;
type Executor = Pick<DrizzleDatabase, "execute">;
type Row = Record<string, unknown>;
type EntityKind = "organization" | "contact";
type NormalizedEntity = Company | Contact;

export type RecoveryApplyResult = {
  state: RecoveryTerminalState;
  targetSummary: Record<string, any>;
};

function resultRows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const rows = (value as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? rows as Row[] : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function present(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

export function fillMissing<T extends Record<string, unknown>>(
  local: T,
  source: Partial<T>,
): Partial<T> {
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    !present(local[key]) && present(value),
  )) as Partial<T>;
}

function entityType(candidate: RecoveryCandidate): EntityKind | null {
  return candidate.streamType === "company"
    ? "organization"
    : candidate.streamType === "contact"
      ? "contact"
      : null;
}

function normalized(candidate: RecoveryCandidate): NormalizedEntity | null {
  const result = candidate.streamType === "company"
    ? normalizeCompany(candidate.rawSnapshot)
    : candidate.streamType === "contact"
      ? normalizeContact(candidate.rawSnapshot)
      : null;
  return result?.ok ? result.value : null;
}

function logicalValues(value: NormalizedEntity, actRecordId: string | null) {
  if (value.kind === "organization") {
    return {
      name: value.name,
      phone: value.phone,
      normalizedPhone: value.phone ? normalizeNorthAmericanPhone(value.phone) : null,
      website: value.website,
      actIndustry: value.industry,
      address1: value.address1,
      address2: value.address2,
      city: value.city,
      region: value.region,
      postalCode: value.postalCode,
      actRecordId,
    };
  }
  return {
    firstName: value.firstName,
    lastName: value.lastName,
    email: value.email,
    phone: value.phone,
    normalizedPhone: value.phone ? normalizeNorthAmericanPhone(value.phone) : null,
    jobTitle: value.jobTitle,
    address1: value.address1,
    address2: value.address2,
    city: value.city,
    region: value.region,
    postalCode: value.postalCode,
    actRecordId,
  };
}

export class ActEntityRecovery {
  constructor(
    private readonly database: DrizzleDatabase,
    private readonly resolver: ActRecoverySourceLinkResolver,
  ) {}

  private async query(query: ReturnType<typeof sql>, executor: Executor = this.database): Promise<Row[]> {
    return resultRows(await executor.execute(query));
  }

  async recoverEntity(candidate: RecoveryCandidate): Promise<RecoveryApplyResult> {
    const kind = entityType(candidate);
    const source = normalized(candidate);
    if (!kind || !source) {
      return { state: "dropped_unusable", targetSummary: { reason: "source_not_usable" } };
    }
    const sourceRows = await this.query(sql`
      select source_database_key as "sourceDatabaseKey"
      from act_source_records where id = ${candidate.sourceRecordId} limit 1
    `);
    const sourceDatabaseKey = text(sourceRows[0]?.sourceDatabaseKey);
    if (!sourceDatabaseKey) {
      return { state: "needs_review", targetSummary: { reason: "source_scope_missing" } };
    }

    const existing = await this.resolver.resolveLocalSource(candidate.sourceRecordId);
    if (existing.kind === "ambiguous") {
      return {
        state: "needs_review",
        targetSummary: { reason: "ambiguous_source_link", candidates: existing.candidates },
      };
    }

    let targetId = existing.kind === "resolved" ? existing.entityId : null;
    let created = false;
    let linked = false;
    if (!targetId) {
      const matches = await this.exactMatches(source);
      if (matches.length > 1) {
        return {
          state: "needs_review",
          targetSummary: { reason: "ambiguous_exact_match", candidates: matches.map(({ id }) => id) },
        };
      }
      if (matches[0]) {
        targetId = text(matches[0].id);
      } else {
        targetId = await this.createTarget(source, candidate.actRecordId);
        created = true;
      }
      if (!candidate.actRecordId) {
        return {
          state: "needs_review",
          targetSummary: { reason: "act_record_id_missing", entityType: kind, entityId: targetId },
        };
      }
      await this.ensureLink({
        entityType: kind,
        entityId: targetId,
        sourceEntityType: candidate.streamType,
        actRecordId: candidate.actRecordId,
        sourceDatabaseKey,
        sourceRecordId: candidate.sourceRecordId,
      });
      linked = true;
    }

    const changedFields = await this.fillTarget(kind, targetId, logicalValues(source, candidate.actRecordId));
    const changed = created || linked || changedFields.length > 0;
    if (changed) {
      await this.audit(kind, targetId, candidate, { created, linked, changedFields });
    }
    return {
      state: changed ? "recovered" : "already_present",
      targetSummary: { entityType: kind, entityId: targetId, created, linked, changedFields },
    };
  }

  private async exactMatches(source: NormalizedEntity): Promise<Row[]> {
    if (source.kind === "organization") {
      if (source.city && source.region) {
        return this.query(sql`
          select id from organizations
          where lower(btrim(name)) = lower(btrim(${source.name}))
            and lower(btrim(coalesce(city, ''))) = lower(btrim(${source.city}))
            and lower(btrim(coalesce(region, ''))) = lower(btrim(${source.region}))
          order by id limit 3
        `);
      }
      return this.query(sql`
        select id from organizations
        where lower(btrim(name)) = lower(btrim(${source.name}))
        order by id limit 3
      `);
    }
    if (source.emailIdentityMatchSafe && source.email) {
      return this.query(sql`
        select id from contacts
        where lower(btrim(coalesce(email, ''))) = lower(btrim(${source.email}))
        order by id limit 3
      `);
    }
    if (source.phone) {
      const normalizedPhone = normalizeNorthAmericanPhone(source.phone);
      if (normalizedPhone) {
        return this.query(sql`
          select id from contacts
          where lower(btrim(first_name)) = lower(btrim(${source.firstName}))
            and lower(btrim(last_name)) = lower(btrim(${source.lastName}))
            and normalized_phone = ${normalizedPhone}
          order by id limit 3
        `);
      }
    }
    return this.query(sql`
      select id from contacts
      where lower(btrim(first_name)) = lower(btrim(${source.firstName}))
        and lower(btrim(last_name)) = lower(btrim(${source.lastName}))
      order by id limit 3
    `);
  }

  private async createTarget(source: NormalizedEntity, actRecordId: string | null): Promise<string> {
    if (source.kind === "organization") {
      const rows = await this.query(sql`
        insert into organizations
          (name, phone, normalized_phone, website, act_industry, address_1, address_2,
           city, region, postal_code, act_record_id, created_at, updated_at)
        values (${source.name}, ${source.phone}, ${source.phone ? normalizeNorthAmericanPhone(source.phone) : null},
          ${source.website}, ${source.industry}, ${source.address1}, ${source.address2},
          ${source.city}, ${source.region}, ${source.postalCode}, ${actRecordId}, now(), now())
        returning id
      `);
      return text(rows[0]?.id);
    }
    const rows = await this.query(sql`
      insert into contacts
        (first_name, last_name, email, phone, normalized_phone, job_title, address_1, address_2,
         city, region, postal_code, act_record_id, created_at, updated_at)
      values (${source.firstName}, ${source.lastName}, ${source.email}, ${source.phone},
        ${source.phone ? normalizeNorthAmericanPhone(source.phone) : null}, ${source.jobTitle},
        ${source.address1}, ${source.address2}, ${source.city}, ${source.region}, ${source.postalCode},
        ${actRecordId}, now(), now())
      returning id
    `);
    return text(rows[0]?.id);
  }

  private async ensureLink(input: {
    entityType: EntityKind;
    entityId: string;
    sourceEntityType: string;
    actRecordId: string;
    sourceDatabaseKey: string;
    sourceRecordId: string;
  }) {
    await this.database.execute(sql`
      insert into act_external_links
        (entity_type, entity_id, source_entity_type, act_record_id, source_database_key,
         source_record_id, is_primary, sync_mode)
      values (${input.entityType}, ${input.entityId}, ${input.sourceEntityType}, ${input.actRecordId},
        ${input.sourceDatabaseKey}, ${input.sourceRecordId}, false, 'pull_only')
      on conflict do nothing
    `);
  }

  private async fillTarget(kind: EntityKind, entityId: string, source: Record<string, unknown>): Promise<string[]> {
    const table = kind === "organization" ? "organizations" : "contacts";
    const logicalColumns = kind === "organization"
      ? {
          name: "name", phone: "phone", normalizedPhone: "normalized_phone", website: "website",
          actIndustry: "act_industry", address1: "address_1", address2: "address_2", city: "city",
          region: "region", postalCode: "postal_code", actRecordId: "act_record_id",
        }
      : {
          firstName: "first_name", lastName: "last_name", email: "email", phone: "phone",
          normalizedPhone: "normalized_phone", jobTitle: "job_title", address1: "address_1",
          address2: "address_2", city: "city", region: "region", postalCode: "postal_code",
          actRecordId: "act_record_id",
        };
    const currentRows = await this.query(sql`select * from ${sql.raw(table)} where id = ${entityId} limit 1`);
    const current = currentRows[0];
    if (!current) throw new Error("act_recovery_target_missing");
    const logicalCurrent = Object.fromEntries(
      Object.entries(logicalColumns).map(([logical, column]) => [logical, current[column]]),
    );
    const fills = fillMissing(logicalCurrent, source);
    const changedFields = Object.keys(fills);
    if (!changedFields.length) return [];
    const assignments = changedFields.map((logical) =>
      sql`${sql.raw(logicalColumns[logical as keyof typeof logicalColumns]!)} = ${fills[logical]}`,
    );
    await this.database.execute(sql`
      update ${sql.raw(table)} set ${sql.join(assignments, sql`, `)}, updated_at = now()
      where id = ${entityId}
    `);
    return changedFields;
  }

  private async audit(
    kind: EntityKind,
    entityId: string,
    candidate: RecoveryCandidate,
    summary: Record<string, unknown>,
  ) {
    await this.database.execute(sql`
      insert into audit_entries (entity_type, entity_id, action, before, after)
      values (${kind}, ${entityId}, 'act_archive_recovered', null,
        ${JSON.stringify({ sourceRecordId: candidate.sourceRecordId, sourceVersionId: candidate.sourceVersionId, ...summary })}::jsonb)
    `);
  }
}
