import type { Pool } from "pg";
import { pool as defaultPool } from "@workspace/db";

export type BusinessKnowledgeScope =
  | "global"
  | "package"
  | "resource"
  | "sales"
  | "operations";

export type BusinessKnowledgeEntry = {
  id: string;
  seedKey: string | null;
  scope: BusinessKnowledgeScope;
  scopeRecordId: string | null;
  title: string;
  body: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
  active: boolean;
  lastReviewedAt: Date | null;
};

export type BusinessKnowledgeContext = {
  packageTemplateIds: string[];
  resourceIds: string[];
  includeGlobal: boolean;
};

type SeedTarget =
  | { kind: "global" }
  | { kind: "package"; code: string }
  | { kind: "resource"; code: string };

export type BusinessKnowledgeSeedEntry = {
  seedKey: string;
  target: SeedTarget;
  title: string;
  body: string;
  sourceUrl: string | null;
  sourceLabel: string | null;
};

export const initialBusinessKnowledgeSeed: readonly BusinessKnowledgeSeedEntry[] = [
  {
    seedKey: "global-family-business-flexibility",
    target: { kind: "global" },
    title: "Family-business flexibility",
    body:
      "Package counts and equipment lists are normal starting points, not hard caps. Custom event arrangements are allowed when the booking and available resources support them.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center business rule",
  },
  {
    seedKey: "package-adventure-zone-range",
    target: { kind: "package", code: "adventure_zone" },
    title: "Adventure Zone package guideline",
    body:
      "Adventure Zone normally starts around 10–12 main attractions. The actual attraction list and count remain editable for each booking.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center package rule",
  },
  {
    seedKey: "package-warriors-playground-range",
    target: { kind: "package", code: "weekend_warriors" },
    title: "Warrior's Playground package guideline",
    body:
      "Warrior's Playground normally starts around 5 main competitive attractions and can be customized for the event.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center package rule",
  },
  {
    seedKey: "package-pirates-rebellion-range",
    target: { kind: "package", code: "pirates_rebellion" },
    title: "Pirate's Rebellion package guideline",
    body:
      "Pirate's Rebellion normally starts around 3 main wet attractions and can be customized for the event.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center package rule",
  },
  {
    seedKey: "global-games-extras-separate",
    target: { kind: "global" },
    title: "Carnival games and extras",
    body:
      "Carnival games and extras are tracked separately from a package's main-attraction target so they do not distort the normal inflatable count.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center resource rule",
  },
  {
    seedKey: "resource-paintball-shared",
    target: { kind: "resource", code: "paintball_trailer" },
    title: "Paintball is shared equipment",
    body:
      "Paintball is treated as special/shared equipment rather than a normal package attraction and remains subject to resource availability and travel conflicts.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center resource rule",
  },
] as const;

export function filterBusinessKnowledge(
  entries: readonly BusinessKnowledgeEntry[],
  context: BusinessKnowledgeContext,
): BusinessKnowledgeEntry[] {
  const packageIds = new Set(context.packageTemplateIds);
  const resourceIds = new Set(context.resourceIds);
  return entries.filter((entry) => {
    if (!entry.active) return false;
    if (entry.scope === "global") return context.includeGlobal;
    if (entry.scope === "package") {
      return entry.scopeRecordId !== null && packageIds.has(entry.scopeRecordId);
    }
    if (entry.scope === "resource") {
      return entry.scopeRecordId !== null && resourceIds.has(entry.scopeRecordId);
    }
    return context.includeGlobal;
  });
}

export interface BusinessKnowledgeRepository {
  listActiveForContext(input: BusinessKnowledgeContext): Promise<BusinessKnowledgeEntry[]>;
}

function mapRow(row: any): BusinessKnowledgeEntry {
  return {
    id: row.id,
    seedKey: row.seed_key ?? null,
    scope: row.scope,
    scopeRecordId: row.scope_record_id,
    title: row.title,
    body: row.body,
    sourceUrl: row.source_url,
    sourceLabel: row.source_label,
    active: row.active,
    lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at) : null,
  };
}

export class PostgresBusinessKnowledgeRepository
implements BusinessKnowledgeRepository {
  constructor(private readonly pool: Pool = defaultPool) {}

  async listActiveForContext(
    input: BusinessKnowledgeContext,
  ): Promise<BusinessKnowledgeEntry[]> {
    const result = await this.pool.query(
      `SELECT id, seed_key, scope, scope_record_id, title, body,
              source_url, source_label, active, last_reviewed_at
       FROM business_knowledge_entries
       WHERE active = true
         AND (
           ($1::boolean AND scope IN ('global','sales','operations'))
           OR (scope = 'package' AND scope_record_id = ANY($2::uuid[]))
           OR (scope = 'resource' AND scope_record_id = ANY($3::uuid[]))
         )
       ORDER BY scope, title, id`,
      [input.includeGlobal, input.packageTemplateIds, input.resourceIds],
    );
    return result.rows.map(mapRow);
  }

  async upsertInitialSeed(createdBy: string): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const entry of initialBusinessKnowledgeSeed) {
        let scope: BusinessKnowledgeScope;
        let scopeRecordId: string | null = null;
        if (entry.target.kind === "global") {
          scope = "global";
        } else if (entry.target.kind === "package") {
          scope = "package";
          const target = await client.query(
            "SELECT id FROM package_templates WHERE code = $1 LIMIT 1",
            [entry.target.code],
          );
          scopeRecordId = target.rows[0]?.id ?? null;
          if (!scopeRecordId) continue;
        } else {
          scope = "resource";
          const target = await client.query(
            "SELECT id FROM resources WHERE code = $1 LIMIT 1",
            [entry.target.code],
          );
          scopeRecordId = target.rows[0]?.id ?? null;
          if (!scopeRecordId) continue;
        }

        await client.query(
          `INSERT INTO business_knowledge_entries
             (seed_key, scope, scope_record_id, title, body, source_url,
              source_label, active, created_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,now())
           ON CONFLICT (seed_key) DO UPDATE SET
             scope = excluded.scope,
             scope_record_id = excluded.scope_record_id,
             title = excluded.title,
             body = excluded.body,
             source_url = excluded.source_url,
             source_label = excluded.source_label,
             updated_at = now()`,
          [
            entry.seedKey,
            scope,
            scopeRecordId,
            entry.title,
            entry.body,
            entry.sourceUrl,
            entry.sourceLabel,
            createdBy,
          ],
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
