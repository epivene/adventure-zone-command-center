import { randomUUID } from "node:crypto";
import { and, asc, eq, ne, or, type SQL } from "drizzle-orm";
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
import { validateAuthoredTemplateText } from "./communication-template-authoring";
import { canOfficeUseTemplate } from "./communication-template-permissions";

export const PREVIOUS_SYSTEM_SOURCE_NOTE =
  "Reviewed starting copy derived from Adventure Zone Sticky Notes; not verbatim source text.";
export const CURRENT_SYSTEM_SOURCE_NOTE =
  "Adventure Zone Sticky Notes base wording, lightly normalized; Amy sent-email patterns used for tone/usage corroboration. Seed revision 2026-08-24.";

const CURRENT_SYSTEM_REVIEWER = "system:sticky-notes-amy-review";
const PREVIOUS_SYSTEM_REVIEWER = "system:business-drive-review";

type Database = NodePgDatabase<typeof schema>;

type PrivateTemplateInput = {
  name: string;
  subjectTemplate: string | null;
  bodyTemplate: string;
  category?: string;
};

function mapTemplate(
  row: typeof communicationTemplates.$inferSelect,
): CommunicationTemplateRecord {
  return {
    id: row.id,
    code: row.code,
    templateVersion: row.templateVersion,
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

function validatedTokens(input: Pick<PrivateTemplateInput, "subjectTemplate" | "bodyTemplate">) {
  return validateAuthoredTemplateText(input).placeholders;
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

  async listForOffice(officeAccountId: string): Promise<CommunicationTemplateRecord[]> {
    const rows = await this.database
      .select()
      .from(communicationTemplates)
      .where(or(
        and(
          eq(communicationTemplates.accessScope, "office"),
          eq(communicationTemplates.state, "active"),
          or(
            eq(communicationTemplates.ownerKind, "company"),
            eq(communicationTemplates.ownerKind, "shared_office"),
          ),
        ),
        and(
          eq(communicationTemplates.accessScope, "office"),
          eq(communicationTemplates.ownerKind, "office_user"),
          eq(communicationTemplates.ownerOfficeAccountId, officeAccountId),
          ne(communicationTemplates.state, "archived"),
        ),
      ))
      .orderBy(asc(communicationTemplates.name));
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

  async createPrivateForOffice(
    officeAccountId: string,
    input: PrivateTemplateInput,
  ): Promise<CommunicationTemplateRecord> {
    const placeholders = validatedTokens(input);
    const [row] = await this.database
      .insert(communicationTemplates)
      .values({
        code: `office_${officeAccountId}_${randomUUID()}`,
        name: input.name,
        channel: "email",
        category: input.category ?? "custom",
        subjectTemplate: input.subjectTemplate,
        bodyTemplate: input.bodyTemplate,
        allowedPlaceholders: placeholders,
        requiredPlaceholders: placeholders,
        accessScope: "office",
        state: "active",
        ownerKind: "office_user",
        ownerOfficeAccountId: officeAccountId,
        createdByKind: "office_user",
        createdById: officeAccountId,
        sourceTemplateId: null,
        sourceDocumentId: null,
        sourceNote: "Private Office Coordinator template.",
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("TEMPLATE_CREATE_FAILED");
    return mapTemplate(row);
  }

  async updatePrivateForOffice(
    templateId: string,
    officeAccountId: string,
    patch: PrivateTemplateInput,
  ): Promise<CommunicationTemplateRecord> {
    const placeholders = validatedTokens(patch);
    const [row] = await this.database
      .update(communicationTemplates)
      .set({
        name: patch.name,
        subjectTemplate: patch.subjectTemplate,
        bodyTemplate: patch.bodyTemplate,
        category: patch.category ?? "custom",
        allowedPlaceholders: placeholders,
        requiredPlaceholders: placeholders,
        updatedAt: new Date(),
      })
      .where(and(
        eq(communicationTemplates.id, templateId),
        eq(communicationTemplates.ownerKind, "office_user"),
        eq(communicationTemplates.ownerOfficeAccountId, officeAccountId),
        ne(communicationTemplates.state, "archived"),
      ))
      .returning();
    if (!row) throw new Error("TEMPLATE_NOT_MUTABLE");
    return mapTemplate(row);
  }

  async archivePrivateForOffice(
    templateId: string,
    officeAccountId: string,
  ): Promise<CommunicationTemplateRecord> {
    const [row] = await this.database
      .update(communicationTemplates)
      .set({ state: "archived", updatedAt: new Date() })
      .where(and(
        eq(communicationTemplates.id, templateId),
        eq(communicationTemplates.ownerKind, "office_user"),
        eq(communicationTemplates.ownerOfficeAccountId, officeAccountId),
        ne(communicationTemplates.state, "archived"),
      ))
      .returning();
    if (!row) throw new Error("TEMPLATE_NOT_MUTABLE");
    return mapTemplate(row);
  }

  async duplicateForOffice(
    sourceTemplateId: string,
    officeAccountId: string,
    input?: { name?: string },
  ): Promise<CommunicationTemplateRecord> {
    const source = await this.getById(sourceTemplateId);
    if (!source || !canOfficeUseTemplate(source, officeAccountId)) {
      throw new Error("TEMPLATE_NOT_AVAILABLE");
    }
    const [row] = await this.database
      .insert(communicationTemplates)
      .values({
        code: `office_${officeAccountId}_${randomUUID()}`,
        name: input?.name?.trim() || `${source.name} — My copy`,
        channel: source.channel,
        category: source.category,
        subjectTemplate: source.subjectTemplate,
        bodyTemplate: source.bodyTemplate,
        allowedPlaceholders: [...source.allowedPlaceholders],
        requiredPlaceholders: [...source.requiredPlaceholders],
        accessScope: "office",
        state: "active",
        ownerKind: "office_user",
        ownerOfficeAccountId: officeAccountId,
        createdByKind: "office_user",
        createdById: officeAccountId,
        sourceTemplateId: source.id,
        sourceDocumentId: source.sourceDocumentId,
        sourceNote: `Private Office copy of ${source.name}.`,
        reviewedBy: null,
        reviewedAt: null,
        updatedAt: new Date(),
      })
      .returning();
    if (!row) throw new Error("TEMPLATE_CREATE_FAILED");
    return mapTemplate(row);
  }

  async promoteToShared(
    templateId: string,
    actorId: string,
  ): Promise<CommunicationTemplateRecord> {
    const [row] = await this.database
      .update(communicationTemplates)
      .set({
        ownerKind: "shared_office",
        ownerOfficeAccountId: null,
        accessScope: "office",
        state: "active",
        reviewedBy: actorId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(communicationTemplates.id, templateId),
        eq(communicationTemplates.ownerKind, "office_user"),
      ))
      .returning();
    if (!row) throw new Error("TEMPLATE_NOT_PROMOTABLE");
    return mapTemplate(row);
  }

  async seed(
    seeds: readonly CommunicationTemplateSeed[],
    sourceDocumentId: string | null,
  ): Promise<void> {
    for (const seed of seeds) {
      const allowedPlaceholders = extractTemplateTokens(
        `${seed.subjectTemplate ?? ""}\n${seed.bodyTemplate}`,
      ) as TemplatePlaceholder[];
      const [existing] = await this.database
        .select()
        .from(communicationTemplates)
        .where(eq(communicationTemplates.code, seed.code))
        .limit(1);

      const values = {
        templateVersion: seed.templateVersion ?? null,
        name: seed.name,
        channel: seed.channel,
        category: seed.category,
        subjectTemplate: seed.subjectTemplate,
        bodyTemplate: seed.bodyTemplate,
        allowedPlaceholders,
        requiredPlaceholders: [...seed.requiredPlaceholders],
        accessScope: seed.accessScope,
        state: seed.state,
        ownerKind: "company" as const,
        ownerOfficeAccountId: null,
        createdByKind: "system" as const,
        createdById: null,
        sourceTemplateId: null,
        sourceDocumentId,
        sourceNote: seed.sourceNote ?? CURRENT_SYSTEM_SOURCE_NOTE,
        reviewedBy: seed.reviewedBy ?? CURRENT_SYSTEM_REVIEWER,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      };

      if (!existing) {
        await this.database
          .insert(communicationTemplates)
          .values({ code: seed.code, ...values });
        continue;
      }

      const safeKnownSystemSeed =
        existing.ownerKind === "company"
        && existing.createdByKind === "system"
        && existing.state !== "archived";

      if (!safeKnownSystemSeed) continue;

      await this.database
        .update(communicationTemplates)
        .set(values)
        .where(eq(communicationTemplates.id, existing.id));
    }
  }
}
