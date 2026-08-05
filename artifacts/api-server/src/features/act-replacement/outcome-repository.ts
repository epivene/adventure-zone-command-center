import { and, eq } from "drizzle-orm";
import type { db as database } from "@/db/client";
import { actReplacementOutcomes } from "@workspace/db/schema";
import type { ActReplacementOutcomeState } from "./import-types";

type DrizzleDatabase = typeof database;
export type OutcomeSeed = { runId: string; sourceRecordId: string; sourceVersionId: string; state?: ActReplacementOutcomeState; normalized?: Record<string, unknown> | null; mappingWarnings?: string[]; unsupportedFieldPaths?: string[] };
export type OutcomePatch = Partial<Omit<Pick<typeof actReplacementOutcomes.$inferInsert, "normalized" | "mappingWarnings" | "unsupportedFieldPaths" | "issues" | "candidates" | "match" | "lastErrorCode" | "targetEntityType" | "targetEntityId" | "organizedAt">, never>> & { state?: ActReplacementOutcomeState };

export interface ActOutcomeRepository { seed(input: OutcomeSeed): Promise<unknown>; list(runId: string): Promise<unknown[]>; update(runId: string, sourceRecordId: string, patch: OutcomePatch): Promise<unknown>; }

/** Small deterministic repository useful for organizer tests and local previews. */
export class InMemoryActOutcomeRepository implements ActOutcomeRepository {
  private readonly rows = new Map<string, OutcomeSeed>();
  async seed(input: OutcomeSeed) { const key = JSON.stringify([input.runId, input.sourceRecordId]); const prior = this.rows.get(key); if (prior) { if (prior.sourceVersionId !== input.sourceVersionId) throw new Error("Act replacement outcome source version is stale."); return prior; } const row = { ...input, state: input.state ?? "pending" as const, mappingWarnings: [...(input.mappingWarnings ?? [])], unsupportedFieldPaths: [...(input.unsupportedFieldPaths ?? [])] }; this.rows.set(key, row); return row; }
  async list(runId: string) { return [...this.rows.values()].filter((row) => row.runId === runId).sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)); }
  async update(runId: string, sourceRecordId: string, patch: OutcomePatch) { const key = JSON.stringify([runId, sourceRecordId]); const row = this.rows.get(key); if (!row) throw new Error("Act replacement outcome not found."); const updated = { ...row, ...patch }; this.rows.set(key, updated); return updated; }
}

export class DrizzleActOutcomeRepository implements ActOutcomeRepository {
  constructor(private readonly database: DrizzleDatabase) {}
  async seed(input: OutcomeSeed) {
    const [row] = await this.database.insert(actReplacementOutcomes).values({ runId: input.runId, sourceRecordId: input.sourceRecordId, sourceVersionId: input.sourceVersionId, state: input.state ?? "pending", normalized: input.normalized ?? null, mappingWarnings: input.mappingWarnings ?? [], unsupportedFieldPaths: input.unsupportedFieldPaths ?? [] }).onConflictDoNothing({ target: [actReplacementOutcomes.runId, actReplacementOutcomes.sourceRecordId] }).returning();
    if (row) return row;
    const [existing] = await this.database.select().from(actReplacementOutcomes).where(and(eq(actReplacementOutcomes.runId, input.runId), eq(actReplacementOutcomes.sourceRecordId, input.sourceRecordId))).limit(1);
    if (!existing) throw new Error("Act replacement outcome could not be seeded.");
    if (existing.sourceVersionId !== input.sourceVersionId) throw new Error("Act replacement outcome source version is stale.");
    return existing;
  }
  async list(runId: string) { return this.database.select().from(actReplacementOutcomes).where(eq(actReplacementOutcomes.runId, runId)); }
  async update(runId: string, sourceRecordId: string, patch: OutcomePatch) { const [row] = await this.database.update(actReplacementOutcomes).set({ ...patch, updatedAt: new Date() }).where(and(eq(actReplacementOutcomes.runId, runId), eq(actReplacementOutcomes.sourceRecordId, sourceRecordId))).returning(); if (!row) throw new Error("Act replacement outcome not found."); return row; }
}
