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

const faqUrl = "https://www.the-adventure-zone.com/general-5";
const unitsUrl = "https://www.the-adventure-zone.com/projects-6";
const websiteFaqLabel = "Adventure Zone website FAQ";

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
    seedKey: "global-event-pricing-model",
    target: { kind: "global" },
    title: "Event-specific pricing",
    body:
      "Adventure Zone uses event-specific pricing, not pricing by individual inflatable. Some events may use no up-front fee with a percentage of ticket-box sales paid back to the event holder; other events pay an event fee so attractions are free to attendees. Treat every ACT note or prior quote as historical pricing evidence tied to its source/year, not as the current price. Confirm current pricing before quoting a new event.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "global-setup-teardown-forklift",
    target: { kind: "global" },
    title: "Standard setup and teardown requirements",
    body:
      "Plan for permission to set up 2 days before the event and one day for teardown after the event. The event holder must provide a forklift or loader for loading inflatables back onto the trailer at teardown; the public FAQ lists a $500 fee if Adventure Zone must procure one. Inflatables are set once in the organizer-approved area; the public FAQ lists a $2,500 charge if already-set inflatables must be moved.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "global-contracts-2026",
    target: { kind: "global" },
    title: "Signed contracts required",
    body:
      "Starting in 2026, the public FAQ says every engagement requires a signed contract, including long-standing customers.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "global-insurance-contact",
    target: { kind: "global" },
    title: "Insurance and COI contacts",
    body:
      "Amanda Morton (amanda@protectiveins.net) is the primary insurance contact and receives new certificate-of-insurance (COI) requests. Sara Toone (sara@protectiveins.net) is the backup contact and should be used only when Amanda is unavailable.",
    sourceUrl: null,
    sourceLabel: "Approved Command Center business rule",
  },
  {
    seedKey: "package-adventure-zone-range",
    target: { kind: "package", code: "adventure_zone" },
    title: "Adventure Zone package guideline",
    body:
      "Adventure Zone normally starts around 10–12 main attractions in Command Center. The public website describes the unit as 10 inflatable attractions plus roughly 3–5 carnival-style games, while the FAQ notes larger event configurations may reach 10–30 attractions. The exact equipment remains editable for each booking.",
    sourceUrl: unitsUrl,
    sourceLabel: "Adventure Zone website Units page + approved Command Center rule",
  },
  {
    seedKey: "package-adventure-zone-site-requirements",
    target: { kind: "package", code: "adventure_zone" },
    title: "Adventure Zone site requirements",
    body:
      "Space: prefer about 10,000 sq ft; can squeeze to about 7,000 sq ft. Power within 75 ft: three 50A/220V outlets, or eighteen 110V outlets, or in Idaho an electrician may hardwire the equivalent breakers, or a 50 kW generator. Water is optional for dry operation; for wet rides provide a faucet/hose within 75 ft. Anchoring: about 80 Adventure Zone-provided 3-ft stakes, or organizer-provided approved ballast such as about 30 one-ton cement barricades or 80 55-gallon-or-heavier water barrels.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "package-warriors-playground-range",
    target: { kind: "package", code: "weekend_warriors" },
    title: "Warrior's Playground package guideline",
    body:
      "Warrior's Playground normally starts around 5 main competitive attractions. The public website describes three Warrior games, one obstacle course, and one action-pursuit gaming arena, plus about 2 carnival-style games. Exact attractions depend on the leg/equipment available for that event.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "package-warriors-playground-site-requirements",
    target: { kind: "package", code: "weekend_warriors" },
    title: "Warrior's Playground site requirements",
    body:
      "Space: prefer about 15,000 sq ft; can squeeze to about 12,000 sq ft. Power within 75 ft: two 50A/220V outlets, or twelve 15A/110V outlets, or in Idaho an electrician may hardwire the equivalent breakers, or a 25 KW generator. Ride operation does not require water, but daily cleaning does; provide a faucet/hose within 75 ft. Anchoring: about 60 Adventure Zone-provided 3-ft stakes, or organizer-provided approved ballast such as about 25 one-ton cement barricades or 60 55-gallon-or-heavier water barrels.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "package-pirates-rebellion-range",
    target: { kind: "package", code: "pirates_rebellion" },
    title: "Pirate's Rebellion package guideline",
    body:
      "Pirate's Rebellion normally starts around 3 main wet attractions. The public FAQ describes a large pool with 4–6 pedal-style bumper boats, a 25-ft-plus super slide, and a bounce-house combo, plus about 3 carnival-style games. The exact equipment remains editable for each booking.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
  },
  {
    seedKey: "package-pirates-rebellion-site-requirements",
    target: { kind: "package", code: "pirates_rebellion" },
    title: "Pirate's Rebellion site requirements",
    body:
      "Space: use the FAQ's detailed package section as the working guidance—prefer about 7,000 sq ft and squeeze to about 5,000 sq ft. Power within 75 ft: one 50A/220V outlet, or six 15A/110V outlets, or in Idaho an electrician may hardwire the equivalent breakers, or a 50 kW generator. Water is a major setup need: a garden hose can fill the pool but the FAQ says it may take about 2 days; a dedicated water supply is faster, and a faucet/hose within 75 ft is needed to replace water during operation. Anchoring: about 30 Adventure Zone-provided 3-ft stakes, or organizer-provided approved ballast such as about 10 one-ton cement barricades or 30 55-gallon-or-heavier water barrels.",
    sourceUrl: faqUrl,
    sourceLabel: websiteFaqLabel,
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
      "Paintball is treated as special/shared equipment rather than a normal package attraction and remains subject to resource availability, transfer, and travel conflicts even when used with Warrior's Playground.",
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
             updated_at = now()
           WHERE business_knowledge_entries.last_reviewed_at IS NULL`,
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
