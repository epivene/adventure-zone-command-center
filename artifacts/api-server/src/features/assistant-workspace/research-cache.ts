import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Evidence, Queryable, RunContext, ToolResult } from "./contracts";
import { fingerprint } from "./action-store";
import { blocked } from "./read-tools";
import { publicResearchSchema, safePublicUrl } from "./public-research";

const DAY_MS = 24 * 60 * 60 * 1000;
const metadataSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  scopeFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  queryFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  requestedModel: z.string().min(1).max(200),
  generatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  reusedAt: z.string().datetime().nullable(),
  stale: z.boolean(),
});
type Metadata = z.infer<typeof metadataSchema>;
type Report = z.infer<typeof publicResearchSchema>;
type SavedReport = { result: ToolResult; report: Report; metadata: Metadata };

const normalizeQuery = (query: string) => query.trim().replace(/\s+/g, " ");
const scopeFingerprint = (context: RunContext) =>
  fingerprint({
    organizationIds: [...new Set(context.selection.organizationIds)].sort(),
    eventYear: context.selection.eventYear,
    batchId: context.selection.batchId ?? null,
    bookingId: context.selection.bookingId,
    threadId: context.selection.threadId,
    draftId: context.selection.draftId,
  });

function completedReport(result: ToolResult): Report | null {
  const report = publicResearchSchema.safeParse(result?.data);
  if (
    result?.status !== "ok" ||
    result.code !== null ||
    result.usageUnknown === true ||
    !report.success ||
    !report.data.complete ||
    !report.data.parts.some((part) => part.citations.length) ||
    !Array.isArray(result.evidence) ||
    !result.evidence.length ||
    !Array.isArray(result.receipts) ||
    result.receipts.length
  )
    return null;
  const citedUrls = new Set(
    report.data.parts.flatMap((part) => part.citations.map((c) => c.url)),
  );
  if (
    result.evidence.some(
      (e) =>
        !e ||
        typeof e.id !== "string" ||
        e.kind !== "web" ||
        e.complete !== true ||
        !safePublicUrl(e.recordId) ||
        !citedUrls.has(e.recordId) ||
        typeof e.text !== "string" ||
        typeof e.retrievedAt !== "string" ||
        !Number.isFinite(Date.parse(e.retrievedAt)),
    )
  )
    return null;
  return report.data;
}

function savedReport(raw: any): SavedReport | null {
  const report = completedReport(raw);
  const metadata = metadataSchema.safeParse(raw?.data?.savedResearch);
  if (
    !report ||
    !metadata.success ||
    Date.parse(metadata.data.expiresAt) -
      Date.parse(metadata.data.generatedAt) !==
      DAY_MS ||
    metadata.data.queryFingerprint !== fingerprint(normalizeQuery(report.query))
  )
    return null;
  return { result: raw, report, metadata: metadata.data };
}

/**
 * Cross-run reuse of completed reports already persisted by ResearchCallStore.
 * execute must be called INSIDE ResearchCallStore.execute's work callback so the
 * decorated result is durable and same-run interruption guards remain in place.
 * There is one active run per conversation; its tools execute sequentially.
 */
export class SavedResearchCache {
  constructor(
    private readonly db: Queryable,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private async authorized(context: RunContext): Promise<boolean> {
    if (context.actor.role !== "owner" || context.signal.aborted) return false;
    const owned = await this.db.query(
      "SELECT id FROM assistant_workspace_runs WHERE id=$1 AND actor_id=$2 AND conversation_id=$3",
      [context.runId, context.actor.id, context.conversationId],
    );
    return !!owned.rows.length;
  }

  private reuse(saved: SavedReport): ToolResult {
    const now = this.now();
    // Deliberately construct a fresh read result: usage, costCalls, receipts,
    // grants and any other fields on the original paid response are not replayed.
    return {
      status: "ok",
      data: {
        ...saved.report,
        savedResearch: {
          ...saved.metadata,
          reusedAt: now.toISOString(),
          stale: Date.parse(saved.metadata.expiresAt) <= now.getTime(),
        },
      },
      evidence: saved.result.evidence.map((evidence) => ({ ...evidence })),
      receipts: [],
      code: null,
    };
  }

  async execute(
    context: RunContext,
    query: string,
    model: string,
    work: () => Promise<ToolResult>,
    refresh = false,
  ): Promise<ToolResult> {
    if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
    if (!(await this.authorized(context)))
      return blocked("ASSISTANT_RUN_NOT_FOUND");
    if (!query.trim() || query.length > 2000 || !model || model.length > 200)
      return blocked("ASSISTANT_ARGUMENTS_INVALID");
    const scope = scopeFingerprint(context);
    const queryHash = fingerprint(normalizeQuery(query));
    const now = this.now();
    const prior = await this.db.query(
      `SELECT result FROM assistant_workspace_research_calls
       WHERE actor_id=$1 AND conversation_id=$2 AND state='completed'
       AND result->'data'->'savedResearch'->>'scopeFingerprint'=$3
       AND result->'data'->'savedResearch'->>'queryFingerprint'=$4
       AND result->'data'->'savedResearch'->>'requestedModel'=$5
       AND updated_at >= $6::timestamptz
       ORDER BY updated_at DESC,id DESC LIMIT 30`,
      [
        context.actor.id,
        context.conversationId,
        scope,
        queryHash,
        model,
        new Date(now.getTime() - DAY_MS).toISOString(),
      ],
    );
    for (const row of refresh ? [] : prior.rows) {
      const saved = savedReport(row.result);
      if (
        saved &&
        saved.metadata.scopeFingerprint === scope &&
        saved.metadata.queryFingerprint === queryHash &&
        saved.metadata.requestedModel === model &&
        Date.parse(saved.metadata.generatedAt) <= now.getTime() &&
        Date.parse(saved.metadata.expiresAt) > now.getTime()
      )
        return this.reuse(saved);
    }
    if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
    const outcome = await work();
    const report = completedReport(outcome);
    // An interrupted or merely partial report is never promoted to a cache hit.
    if (!report || normalizeQuery(report.query) !== normalizeQuery(query))
      return outcome;
    const completedAt = this.now();
    const id = randomUUID();
    return {
      ...outcome,
      data: {
        ...report,
        savedResearch: {
          version: 1,
          id,
          scopeFingerprint: scope,
          queryFingerprint: queryHash,
          requestedModel: model,
          generatedAt: completedAt.toISOString(),
          expiresAt: new Date(completedAt.getTime() + DAY_MS).toISOString(),
          reusedAt: null,
          stale: false,
        } satisfies Metadata,
      },
      // Stable IDs keep independent reports from replacing each other's web:0:0
      // evidence when the orchestrator projects accumulated source context.
      evidence: outcome.evidence.map((evidence, index) => ({
        ...evidence,
        id: `saved-research:${id}:${index}`,
      })),
    };
  }

  async readSavedResearch(
    context: RunContext,
    id: string,
  ): Promise<ToolResult> {
    if (context.signal.aborted) return blocked("ASSISTANT_CANCELLED");
    if (!(await this.authorized(context)))
      return blocked("ASSISTANT_RUN_NOT_FOUND");
    if (!z.string().uuid().safeParse(id).success)
      return blocked("ASSISTANT_ARGUMENTS_INVALID");
    const scope = scopeFingerprint(context);
    const rows = await this.db.query(
      `SELECT result FROM assistant_workspace_research_calls
       WHERE actor_id=$1 AND conversation_id=$2 AND state='completed'
       AND result->'data'->'savedResearch'->>'scopeFingerprint'=$3
       AND result->'data'->'savedResearch'->>'id'=$4
       ORDER BY updated_at DESC,id DESC LIMIT 1`,
      [context.actor.id, context.conversationId, scope, id],
    );
    const saved = savedReport(rows.rows[0]?.result);
    if (
      !saved ||
      saved.metadata.scopeFingerprint !== scope ||
      saved.metadata.id !== id
    )
      return blocked("ASSISTANT_SAVED_RESEARCH_NOT_FOUND");
    return this.reuse(saved);
  }

  async listIndex(context: RunContext): Promise<Evidence[]> {
    if (!(await this.authorized(context))) return [];
    const scope = scopeFingerprint(context);
    const rows = await this.db.query(
      `SELECT result FROM (
       SELECT DISTINCT ON (result->'data'->'savedResearch'->>'id') result
       FROM assistant_workspace_research_calls
       WHERE actor_id=$1 AND conversation_id=$2 AND state='completed'
       AND result->'data'->'savedResearch'->>'scopeFingerprint'=$3
       ORDER BY result->'data'->'savedResearch'->>'id',updated_at DESC,id DESC
       ) saved ORDER BY result->'data'->'savedResearch'->>'generatedAt' DESC LIMIT 20`,
      [context.actor.id, context.conversationId, scope],
    );
    const now = this.now();
    const saved = rows.rows
      .map((row) => savedReport(row.result))
      .filter(
        (row): row is SavedReport =>
          !!row && row.metadata.scopeFingerprint === scope,
      )
      .sort((a, b) =>
        b.metadata.generatedAt.localeCompare(a.metadata.generatedAt),
      )
      .slice(0, 20);
    return saved.map(({ report, metadata, result }) => ({
      id: `saved-research-index:${metadata.id}`,
      kind: "web",
      recordId: metadata.id,
      eventYear: context.selection.eventYear,
      occurredAt: metadata.generatedAt,
      retrievedAt: metadata.generatedAt,
      version: "saved-research-index-v1",
      complete: false,
      text: JSON.stringify({
        view: "saved_research_index",
        historical: true,
        untrusted: true,
        status: "research_report_saved",
        id: metadata.id,
        question: report.query.slice(0, 400),
        questionTruncated: report.query.length > 400,
        scope: {
          fingerprint: scope,
          organizationIds: [...new Set(context.selection.organizationIds)]
            .sort()
            .slice(0, 5),
          organizationCount: new Set(context.selection.organizationIds).size,
          eventYear: context.selection.eventYear,
        },
        requestedModel: metadata.requestedModel,
        generatedAt: metadata.generatedAt,
        expiresAt: metadata.expiresAt,
        stale: Date.parse(metadata.expiresAt) <= now.getTime(),
        sourceIds: [...new Set(result.evidence.map((e) => e.recordId))].slice(
          0,
          5,
        ),
        sourceCount: new Set(result.evidence.map((e) => e.recordId)).size,
        reportTool: "read_saved_research",
        warning:
          "Historical research index only. A saved report does not verify current facts, complete a profile, or authorize actions.",
      }),
    }));
  }
}
