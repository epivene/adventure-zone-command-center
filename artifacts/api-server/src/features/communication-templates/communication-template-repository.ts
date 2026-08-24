import { and, asc, eq, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import { communicationTemplates } from "@/db/schema";
import type {
  CommunicationTemplateAccess,
  CommunicationTemplateState,
} from "@workspace/db/business-source-schema";
import type {
  CommunicationTemplateRecord,
  CommunicationTemplateSeed,
  TemplatePlaceholder,
} from "./communication-template-types";
import { extractTemplateTokens } from "./communication-template-renderer";

type Database = NodePgDatabase<typeof schema>;

function mapTemplate(
  row: typeof communicationTemplates.$inferSelect,
): CommunicationTemplateRecord {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    channel: row.channel,
    category: row.category,
    accessScope: row.accessScope,
    state: row.state,
    subjectTemplate: row.subjectTemplate,
    bodyTemplate: row.bodyTemplate,
    allowedPlaceholders: row.allowedPlaceholders as TemplatePlaceholder[],
    requiredPlaceholders: row.requiredPlaceholders as TemplatePlaceholder[],
    ownerKind: row.ownerKind,
    ownerOfficeAccountId: row.ownerOfficeAccountId,
    createdByKind: row.createdByKind,
    createdById: row.createdById,
    sourceTemplateId: row.sourceTemplateId,
    sourceDocumentId: row.sourceDocumentId,
    sourceNote: row.sourceNote,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    updatedAt: row.updatedAt,
  };
}

export class CommunicationTemplateRepository {
  constructor(private readonly database: Database) {}

  async list(options?: {
    state?: CommunicationTemplateState;
    accessScope?: CommunicationTemplateAccess;
  }): Promise<CommunicationTemplateRecord[]> {
    const filters: SQL[] = [];
    if (options?.state) filters.push(eq(communicationTemplates.state, options.state));
    if (options?.accessScope) {
      filters.push(eq(communicationTemplates.accessScope, options.accessScope));
    }
    const query = this.database.select().from(communicationTemplates);
    const rows = filters.length
      ? await query.where(and(...filters)).orderBy(asc(communicationTemplates.name))
      : await query.orderBy(asc(communicationTemplates.name));
    return rows.map(mapTemplate);
  }

  async getById(id: string): Promise<CommunicationTemplateRecord | null> {
    const rows = await this.database
      .select()
      .from(communicationTemplates)
      .where(eq(communicationTemplates.id, id))
      .limit(1);
    return rows[0] ? mapTemplate(rows[0]) : null;
  }

  async seed(
    seeds: readonly CommunicationTemplateSeed[],
    sourceDocumentId: string | null,
  ): Promise<void> {
    for (const seed of seeds) {
      const tokens = extractTemplateTokens(
        `${seed.subjectTemplate ?? ""}\n${seed.bodyTemplate}`,
      ) as TemplatePlaceholder[];
      await this.database
        .insert(communicationTemplates)
        .values({
          code: seed.code,
          name: seed.name,
          channel: seed.channel,
          category: seed.category,
          subjectTemplate: seed.subjectTemplate,
          bodyTemplate: seed.bodyTemplate,
          allowedPlaceholders: tokens,
          requiredPlaceholders: [...seed.requiredPlaceholders],
          accessScope: seed.accessScope,
          state: seed.state,
          ownerKind: "company",
          ownerOfficeAccountId: null,
          createdByKind: "system",
          createdById: null,
          sourceTemplateId: null,
          sourceDocumentId,
          sourceNote:
            "Reviewed starting copy derived from Adventure Zone Sticky Notes; not verbatim source text.",
          reviewedBy: "system:business-drive-review",
          reviewedAt: new Date(),
        })
        .onConflictDoNothing({ target: communicationTemplates.code });
    }
  }
}
