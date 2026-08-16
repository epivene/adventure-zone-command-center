import { sql } from "drizzle-orm";

import type { db as applicationDatabase } from "@/db/client";

type DrizzleDatabase = typeof applicationDatabase;
type Row = Record<string, unknown>;

type LocalEntityType = "organization" | "contact" | "booking" | "calling_list";

export type LocalSourceResolution =
  | { kind: "resolved"; entityType: LocalEntityType; entityId: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidates: Array<{ entityType: LocalEntityType; entityId: string }> };

export type ArchivedRelationship = {
  parentSourceRecordId: string;
  parentActRecordId: string;
  targetSourceRecordId: string;
  targetKind: "contact" | "company" | "opportunity";
  targetActRecordId: string;
};

export type RelationshipResolution =
  | { kind: "resolved"; relationship: ArchivedRelationship; target: LocalSourceResolution }
  | { kind: "invalid"; reason: "invalid_relationship_evidence" | "relationship_source_missing" };

const localEntityTypeByStream: Readonly<Record<string, LocalEntityType>> = {
  company: "organization",
  contact: "contact",
  opportunity: "booking",
  group: "calling_list",
};

function rows(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  const result = (value as { rows?: unknown })?.rows;
  return Array.isArray(result) ? result as Row[] : [];
}

function value(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function exactRelationshipEvidence(value: unknown): {
  parentKind: string;
  parentActRecordId: string;
  targetKind: "contact" | "company" | "opportunity";
  targetActRecordId: string;
} | null {
  const evidence = object(value);
  const parentKind = typeof evidence.parentKind === "string" ? evidence.parentKind.trim() : "";
  const parentActRecordId = typeof evidence.parentActRecordId === "string" ? evidence.parentActRecordId.trim() : "";
  const targetKind = evidence.targetKind;
  const targetActRecordId = typeof evidence.targetActRecordId === "string" ? evidence.targetActRecordId.trim() : "";
  if (
    !parentKind ||
    !parentActRecordId ||
    !targetActRecordId ||
    (targetKind !== "contact" && targetKind !== "company" && targetKind !== "opportunity")
  ) return null;
  return { parentKind, parentActRecordId, targetKind, targetActRecordId };
}

export class ActRecoverySourceLinkResolver {
  constructor(private readonly database: DrizzleDatabase) {}

  private async query(query: ReturnType<typeof sql>): Promise<Row[]> {
    return rows(await this.database.execute(query));
  }

  async resolveLocalSource(sourceRecordId: string): Promise<LocalSourceResolution> {
    const sourceRows = await this.query(sql`
      select id, source_database_key as "sourceDatabaseKey", stream_type as "streamType",
        act_record_id as "actRecordId"
      from act_source_records
      where id = ${sourceRecordId}
      limit 1
    `);
    const source = sourceRows[0];
    if (!source) return { kind: "missing" };
    const streamType = value(source.streamType);
    const entityType = localEntityTypeByStream[streamType];
    if (!entityType) return { kind: "missing" };

    let links = await this.query(sql`
      select entity_type as "entityType", entity_id as "entityId"
      from act_external_links
      where source_record_id = ${sourceRecordId}
        and entity_type = ${entityType}
      order by entity_id
    `);
    if (!links.length && value(source.actRecordId)) {
      links = await this.query(sql`
        select entity_type as "entityType", entity_id as "entityId"
        from act_external_links
        where source_record_id is null
          and source_database_key = ${value(source.sourceDatabaseKey)}
          and source_entity_type = ${streamType}
          and act_record_id = ${value(source.actRecordId)}
          and entity_type = ${entityType}
        order by entity_id
      `);
    }

    const candidates = [...new Map(links.map((row) => {
      const candidate = { entityType, entityId: value(row.entityId) };
      return [`${candidate.entityType}:${candidate.entityId}`, candidate] as const;
    })).values()].filter(({ entityId }) => entityId);
    if (candidates.length === 0) return { kind: "missing" };
    if (candidates.length > 1) return { kind: "ambiguous", candidates };
    return { kind: "resolved", ...candidates[0]! };
  }

  async resolveRelationship(sourceRecordId: string): Promise<RelationshipResolution> {
    const relationshipRows = await this.query(sql`
      select source_database_key as "sourceDatabaseKey", relationship_evidence as "relationshipEvidence"
      from act_source_records
      where id = ${sourceRecordId}
      limit 1
    `);
    const source = relationshipRows[0];
    if (!source) return { kind: "invalid", reason: "relationship_source_missing" };
    const evidence = exactRelationshipEvidence(source.relationshipEvidence);
    if (!evidence) return { kind: "invalid", reason: "invalid_relationship_evidence" };

    const parentRows = await this.query(sql`
      select id
      from act_source_records
      where source_database_key = ${value(source.sourceDatabaseKey)}
        and stream_type = ${evidence.parentKind}
        and act_record_id = ${evidence.parentActRecordId}
      order by id
      limit 2
    `);
    const targetRows = await this.query(sql`
      select id
      from act_source_records
      where source_database_key = ${value(source.sourceDatabaseKey)}
        and stream_type = ${evidence.targetKind}
        and act_record_id = ${evidence.targetActRecordId}
      order by id
      limit 2
    `);
    if (parentRows.length !== 1 || targetRows.length !== 1) {
      return { kind: "invalid", reason: "relationship_source_missing" };
    }
    const targetSourceRecordId = value(targetRows[0]!.id);
    return {
      kind: "resolved",
      relationship: {
        parentSourceRecordId: value(parentRows[0]!.id),
        parentActRecordId: evidence.parentActRecordId,
        targetSourceRecordId,
        targetKind: evidence.targetKind,
        targetActRecordId: evidence.targetActRecordId,
      },
      target: await this.resolveLocalSource(targetSourceRecordId),
    };
  }
}
