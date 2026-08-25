import { createHash } from "node:crypto";

import { asc, desc, eq, inArray } from "drizzle-orm";

import type { db as database } from "@/db/client";
import { leadImportBatches, leadImportEvidence, leadImportRows } from "@/db/schema";

type DrizzleDatabase = typeof database;

export type LeadImportSourceRow = {
  sheetName: string;
  rowNumber: number;
  company: string;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  website: string | null;
  industry: string | null;
  originalValues: Record<string, string | null>;
};

export type ImportLeadWorkbookInput = {
  originalFilename: string;
  fileSha256: string;
  importedBy: string;
  rows: LeadImportSourceRow[];
};

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function sourceRowFingerprint(fileSha256: string, row: LeadImportSourceRow): string {
  return createHash("sha256").update(canonical({ fileSha256, ...row })).digest("hex");
}

function trimmed(value: string | null): string | null {
  const result = value?.trim() ?? "";
  return result || null;
}

export class LeadIntakeRepository {
  constructor(private readonly database: DrizzleDatabase) {}

  async importWorkbook(input: ImportLeadWorkbookInput, now = new Date()) {
    return this.database.transaction(async (tx) => {
      const [inserted] = await tx.insert(leadImportBatches).values({
        originalFilename: input.originalFilename,
        fileSha256: input.fileSha256,
        status: "review",
        rowCount: input.rows.length,
        importedBy: input.importedBy,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoNothing({ target: leadImportBatches.fileSha256 }).returning({
        id: leadImportBatches.id,
      });

      if (!inserted) {
        const [existing] = await tx.select({
          id: leadImportBatches.id,
          rowCount: leadImportBatches.rowCount,
        }).from(leadImportBatches).where(eq(leadImportBatches.fileSha256, input.fileSha256)).limit(1);
        if (!existing) throw new Error("Existing lead import batch could not be loaded.");
        return { batchId: existing.id, reused: true, rowCount: existing.rowCount };
      }

      await tx.insert(leadImportRows).values(input.rows.map((row) => {
        const company = trimmed(row.company);
        const warnings = company ? [] : ["Company is missing."];
        return {
          batchId: inserted.id,
          sheetName: row.sheetName,
          sourceRowNumber: row.rowNumber,
          sourceFingerprint: sourceRowFingerprint(input.fileSha256, row),
          originalValues: row.originalValues,
          company,
          phone: trimmed(row.phone),
          address1: trimmed(row.address1),
          address2: trimmed(row.address2),
          city: trimmed(row.city),
          region: trimmed(row.state),
          postalCode: trimmed(row.zipCode),
          website: trimmed(row.website),
          industry: trimmed(row.industry),
          warnings,
          state: company ? "needs_review" as const : "needs_correction" as const,
          createdAt: now,
          updatedAt: now,
        };
      }));
      return { batchId: inserted.id, reused: false, rowCount: input.rows.length };
    });
  }

  async getBatch(batchId: string) {
    const [batch] = await this.database.select().from(leadImportBatches)
      .where(eq(leadImportBatches.id, batchId)).limit(1);
    if (!batch) return null;
    const rows = await this.database.select().from(leadImportRows)
      .where(eq(leadImportRows.batchId, batchId))
      .orderBy(asc(leadImportRows.sheetName), asc(leadImportRows.sourceRowNumber));
    const evidence = rows.length
      ? await this.database.select().from(leadImportEvidence)
        .where(inArray(leadImportEvidence.rowId, rows.map((row) => row.id)))
        .orderBy(asc(leadImportEvidence.createdAt))
      : [];
    const evidenceByRow = new Map<string, typeof evidence>();
    for (const item of evidence) {
      const values = evidenceByRow.get(item.rowId) ?? [];
      values.push(item);
      evidenceByRow.set(item.rowId, values);
    }
    return { ...batch, rows: rows.map((row) => ({ ...row, evidence: evidenceByRow.get(row.id) ?? [] })) };
  }

  async listBatches() {
    return this.database.select().from(leadImportBatches)
      .orderBy(desc(leadImportBatches.createdAt));
  }
}
