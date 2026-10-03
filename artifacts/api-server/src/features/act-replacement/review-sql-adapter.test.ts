import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { approvalClosureFromDurableRow, approvalManifestFromRows, approvalOperationSelection, approvalOutcomeSelection, automaticReviewSummaryFromDecisions, automaticTargetExactMatchQuery, currentManifestOperationPredicate, DrizzleActReviewCommandStore, DrizzleActReviewReader, DrizzleProductionOrganizerStore, lockAutomaticReviewSourceRowsQuery, lockBulkSourceRowsQuery, manifestFromRows, manifestSourcesFromArchiveRows, manifestWriteBatches, operationSemanticsMatch, projectActReviewDisplay, staleNonterminalOperationPredicate } from "./review-sql-adapter";
import { ProductionActOrganizer, type ProductionOrganizerStore } from "./production-organizer";
import { automaticReviewRequestFingerprint, individualDecisionRequestFingerprint } from "./review-command-service";
import { digestLegacyManifestRows } from "./manifest-digest";
import { fingerprintSourceContent } from "./source-fingerprint";
import { actReplacementApprovalRequests, actReplacementApplyOperations, actReplacementOutcomes, actReplacementReviewDecisions, actReplacementRuns, actSourceRecords } from "@workspace/db/schema";
import { logger } from "@/lib/logger";

beforeEach(() => {
  vi.spyOn(logger, "info").mockImplementation(() => undefined);
  vi.spyOn(logger, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.restoreAllMocks());

describe("durable review adapter projections", () => {
  const unsupportedBulkStoreInput = (selections: Array<{ sourceRecordId: string; sourceVersionId: string }>) => ({
    scope: "unsupported_record" as const,
    decision: "ignore_source" as const,
    fieldName: null,
    selections,
  });
  const unsupportedBulkManifest = (selections: Array<{ sourceRecordId: string; sourceVersionId: string }>) => ({
    digest: "digest-2",
    diagnostics: [],
    operations: [],
    outcomes: selections.map((selection) => ({
      ...selection,
      state: "unsupported" as const,
      issues: [{ code: "unsupported_record", reason: "normalization_failed" }],
      candidates: [],
      match: null,
      mappingWarnings: [],
      unsupportedFieldPaths: [],
      operationKeys: [],
    })),
  });
  const pendingAutomaticRecoveryHarness = () => {
    const input = {
      expectedManifestDigest: "digest-before",
      owner: "owner",
      requestKey: "automatic-lease",
      policyVersion: "2026-08-12",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "v-unsupported",
      scope: "unsupported_record" as const, decision: "ignore_source" as const,
      requestKey: "automatic-lease:1", requestFingerprint: "individual-fingerprint",
      fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null,
      reviewedSourceValue: null, reviewedSourceValueFingerprint: null,
      reviewedLocalValue: null, reviewedLocalValueFingerprint: null,
      decidedBy: "owner", active: true, supersededAt: null, supersededBy: null, createdAt: new Date(),
    };
    const request: Record<string, unknown> = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [decision],
      }),
      requestedBy: "owner", decisionIds: [decision.id], manifestDigest: "__pending_review_rebuild__",
      expectedManifestDigest: input.expectedManifestDigest, reviewedOperationIds: [], rebuildState: "pending",
      rebuildToken: null, rebuildLeaseExpiresAt: null,
      automaticSummary: automaticReviewSummaryFromDecisions([decision as never]),
    };
    let cleanupAttempts = 0;
    let renewals = 0;
    let runDigest = "digest-before";
    let runDigestVersion: string | undefined;
    const execute = async (query: unknown) => {
      const rendered = new PgDialect().sqlToQuery(query as never);
      if (rendered.sql.includes("with candidate as")) {
        const leaseExpired = !request.rebuildLeaseExpiresAt
          || new Date(request.rebuildLeaseExpiresAt as Date | string).getTime() <= Date.now();
        if (request.rebuildState !== "pending" && !(request.rebuildState === "rebuilding" && leaseExpired))
          return { rows: [] };
        const token = rendered.params.find((value) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)) as string;
        Object.assign(request, {
          rebuildState: "rebuilding",
          rebuildToken: token,
          rebuildLeaseExpiresAt: rendered.params.find((value) => value instanceof Date && value.getTime() > Date.now()) ?? null,
        });
        return { rows: [{
          runId: "run", requestKey: input.requestKey, requestFingerprint: request.requestFingerprint,
          requestedBy: input.owner, expectedManifestDigest: input.expectedManifestDigest,
          automaticSummary: request.automaticSummary, decisionIds: request.decisionIds,
        }] };
      }
      if (rendered.sql.includes("select expected_manifest_digest")) return { rows: [{
        expectedManifestDigest: request.expectedManifestDigest,
        automaticSummary: request.automaticSummary,
        rebuildState: request.rebuildState,
        rebuildToken: request.rebuildToken,
        rebuildLeaseExpiresAt: request.rebuildLeaseExpiresAt,
      }] };
      if (rendered.sql.includes("select request_fingerprint")) return { rows: [request] };
      const token = rendered.params.find((value) => typeof value === "string" && /^[0-9a-f-]{36}$/.test(value)) as string | undefined;
      if (rendered.sql.includes("set rebuild_state") && rendered.sql.includes("rebuild_token = null")
        && !rendered.sql.includes("set manifest_digest")) {
        cleanupAttempts += 1;
        if (token && request.rebuildToken === token) {
          Object.assign(request, { rebuildState: "pending", rebuildToken: null, rebuildLeaseExpiresAt: null });
          return { rows: [{ id: "request" }] };
        }
        return { rows: [] };
      }
      if (rendered.sql.includes("set rebuild_lease_expires_at") && !rendered.sql.includes("set rebuild_state")) {
        renewals += 1;
        if (token && request.rebuildToken === token) {
          request.rebuildLeaseExpiresAt = rendered.params.find((value) => value instanceof Date) ?? null;
          return { rows: [{ id: "request" }] };
        }
        return { rows: [] };
      }
      if (rendered.sql.includes("set manifest_digest")) {
        if (!token || request.rebuildToken === token) {
          Object.assign(request, {
            manifestDigest: "digest-after", reviewedOperationIds: [], rebuildState: "complete",
            rebuildToken: null, rebuildLeaseExpiresAt: null,
          });
          return { rows: [{ id: "request" }] };
        }
        return { rows: [] };
      }
      if (rendered.sql.includes("set rebuild_state") && rendered.sql.includes("rebuild_token =")) {
        Object.assign(request, {
          rebuildState: "rebuilding",
          rebuildToken: token ?? null,
          rebuildLeaseExpiresAt: rendered.params.find((value) => value instanceof Date) ?? null,
        });
        return { rows: [{ id: "request" }] };
      }
      return { rows: [] };
    };
    const rowsFor = (table: unknown) => table === actReplacementRuns
      ? [{ summary: { manifestDigest: runDigest }, manifestDigestVersion: runDigestVersion, phase: "ready_to_apply" }]
      : table === actReplacementReviewDecisions ? [decision] : [request];
    const select = () => {
      let table: unknown;
      const chain = {
        from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
        for: async () => rowsFor(table), then: (resolve: (rows: unknown[]) => unknown) => resolve(rowsFor(table)),
      };
      return chain;
    };
    const transaction = { select, execute };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      select,
      execute,
    } as never;
    return {
      input, request, database,
      cleanupAttempts: () => cleanupAttempts,
      renewals: () => renewals,
      publishRunDigest: (digest: string) => {
        runDigest = digest;
        runDigestVersion = "canonical-json-v1";
      },
    };
  };
  const postRebuildRecoveryHarness = () => {
    const input = {
      expectedManifestDigest: "a".repeat(64), owner: "owner", requestKey: "post-rebuild", policyVersion: "2026-08-12",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "v-unsupported",
      scope: "unsupported_record" as const, decision: "ignore_source" as const,
      requestKey: "post-rebuild:1", requestFingerprint: "individual-fingerprint",
      fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null,
      reviewedSourceValue: null, reviewedSourceValueFingerprint: null,
      reviewedLocalValue: null, reviewedLocalValueFingerprint: null,
      decidedBy: "owner", active: true, supersededAt: null, supersededBy: null, createdAt: new Date(),
    };
    const manifest = manifestFromRows({
      operations: [],
      outcomes: [{
        sourceRecordId: decision.sourceRecordId, sourceVersionId: decision.sourceVersionId, state: "ignored",
        issues: [{ code: "unsupported_record", reason: "normalization_failed" }], candidates: [],
        match: null, mappingWarnings: [], unsupportedFieldPaths: [],
      }],
    });
    const request = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [decision],
      }),
      requestedBy: "owner", decisionIds: [decision.id], manifestDigest: "__pending_review_rebuild__",
      expectedManifestDigest: input.expectedManifestDigest, reviewedOperationIds: [], rebuildState: "pending",
      rebuildToken: null, rebuildLeaseExpiresAt: null,
      automaticSummary: automaticReviewSummaryFromDecisions([decision as never]),
    };
    let sourceLocks = 0;
    let finalizations = 0;
    const rowsFor = (table: unknown) => table === actReplacementRuns
      ? [{ summary: { manifestDigest: manifest.digest }, manifestDigestVersion: "canonical-json-v1", phase: "ready_to_apply" }]
      : table === actReplacementReviewDecisions ? [decision] : [request];
    const transaction = {
      select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
          for: async () => rowsFor(table), then: (resolve: (rows: unknown[]) => unknown) => resolve(rowsFor(table)),
        };
        return chain;
      },
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("select expected_manifest_digest")) return { rows: [{
          expectedManifestDigest: request.expectedManifestDigest, automaticSummary: request.automaticSummary,
          rebuildState: request.rebuildState, rebuildToken: request.rebuildToken,
          rebuildLeaseExpiresAt: request.rebuildLeaseExpiresAt,
        }] };
        if (rendered.includes("act_source_records") && rendered.includes("for update")) {
          sourceLocks += 1;
          return { rows: [{ sourceRecordId: decision.sourceRecordId, sourceVersionId: decision.sourceVersionId, streamType: "contact" }] };
        }
        if (rendered.includes("set manifest_digest")) {
          finalizations += 1;
          return { rows: [{ id: "request" }] };
        }
        return { rows: [] };
      },
    };
    return {
      input, decision, manifest,
      database: { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never,
      sourceLocks: () => sourceLocks,
      finalizations: () => finalizations,
    };
  };
  it("bounds approval manifest reads and preserves operation status", () => {
    expect(Object.keys(approvalOutcomeSelection).sort()).toEqual([
      "sourceRecordId",
      "sourceVersionId",
      "state",
    ]);
    expect(approvalOutcomeSelection).not.toHaveProperty("match");
    expect(approvalOperationSelection).toHaveProperty("status");

    const manifest = approvalManifestFromRows({
      digest: "a".repeat(64),
      operations: [{
        operationKey: "organization:a",
        sourceRecordId: "a",
        sourceVersionId: "v-a",
        targetType: "organization",
        action: "create",
        payload: { automaticReview: { version: 1, eligible: true, disposition: "safe_ready", basis: "safe_create" } },
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
        status: "applied",
      }],
      outcomes: [{
        sourceRecordId: "a",
        sourceVersionId: "v-a",
        state: "ready",
        match: { evidence: [{ secret: "unbounded-match-sentinel" }] },
      }],
    });

    expect(manifest.operations[0]).toMatchObject({
      operationKey: "organization:a",
      status: "applied",
    });
    expect(manifest.outcomes[0]).toMatchObject({
      sourceRecordId: "a",
      state: "ready",
      match: null,
    });
    expect(JSON.stringify(manifest)).not.toContain("unbounded-match-sentinel");
  });

  it("projects only bounded proof fields for durable approval reads", () => {
    const rendered = new PgDialect().sqlToQuery(
      sql`select ${approvalOperationSelection.payload}`,
    );

    expect(rendered.sql).toContain("jsonb_strip_nulls");
    expect(rendered.sql).toContain("automaticReview");
    expect(rendered.sql).toContain("overwrite_reviewed");
    expect(rendered.sql).not.toContain("normalized");
  });

  it("rejects string-coerced and extra-key automatic proofs in the approval SQL reader", () => {
    const rendered = new PgDialect().sqlToQuery(
      sql`select ${approvalOperationSelection.payload}`,
    ).sql;

    expect(rendered).toContain("::jsonb -> 'automaticReview'::text");
    expect(rendered).toContain("?& array['version','eligible','disposition','basis']::text[]");
    expect(rendered).toContain("- 'version'::text - 'eligible'::text - 'disposition'::text - 'basis'::text");
    expect(rendered).toContain("->'version') = 'number'");
    expect(rendered).toContain("->'eligible') = 'boolean'");
    expect(rendered).toContain("->'disposition') = 'string'");
    expect(rendered).toContain("->'basis') = 'string'");
    expect(rendered).not.toContain("#>> '{automaticReview");
  });

  it("replays approval requests through the bounded SQL manifest reader", async () => {
    const manifestDigest = "a".repeat(64);
    const operation = {
      operationKey: "organization:a",
      sourceRecordId: "a",
      sourceVersionId: "v-a",
      targetType: "organization",
      action: "create",
      payload: {
        automaticReview: {
          version: 1,
          eligible: true,
          disposition: "safe_ready",
          basis: "safe_create",
        },
      },
      dependencyOperationKeys: [],
      requiredForSourceOutcome: true,
      safeByDefault: true,
      status: "pending",
    };
    const request: Record<string, unknown> = {
      selectedOperationIds: [operation.operationKey],
      dependencyClosedOperationIds: [operation.operationKey],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 0,
      manifestDigest,
      approvalMode: "automatic_safe",
      approvalModeVersion: 1,
    };
    const database = {
      select: () => {
        let table: unknown;
        const rows = () => {
          if (table === actReplacementRuns)
            return [{ id: "run", summary: { manifestDigest } }];
          if (table === actReplacementApprovalRequests) return [request];
          if (table === actReplacementApplyOperations) return [operation];
          if (table === actReplacementOutcomes)
            return [{ sourceRecordId: "a", sourceVersionId: "v-a", state: "archived_only" }];
          return [];
        };
        const chain = {
          from: (value: unknown) => { table = value; return chain; },
          where: () => chain,
          limit: async () => rows(),
          then: (resolve: (value: unknown[]) => unknown) => resolve(rows()),
        };
        return chain;
      },
    } as never;
    const store = new DrizzleActReviewCommandStore(
      database,
      { sourceDatabaseKey: "act-db" },
      {} as never,
    );
    vi.spyOn(store, "getManifest").mockRejectedValue(
      new Error("unbounded manifest reader called"),
    );

    await expect(store.getApprovalRepository().getRequest("run", "request"))
      .resolves.toMatchObject({
        approvedOperationIds: [operation.operationKey],
        manifestDigest,
        approvalMode: "automatic_safe",
        approvalModeVersion: 1,
      });
  });

  it("writes approval provenance with every durable approval request", async () => {
    let inserted: Record<string, unknown> | undefined;
    const database = {
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: async () => [{ id: "run" }],
        };
        return chain;
      },
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          inserted = value;
          return {
            onConflictDoNothing: () => ({ returning: async () => [{ id: "request" }] }),
          };
        },
      }),
    } as never;
    const repository = new DrizzleActReviewCommandStore(
      database,
      { sourceDatabaseKey: "act-db" },
      {} as never,
    ).getApprovalRepository();

    await repository.saveRequest("run", "request", {
      selectedOperationIds: ["safe:create"],
      approvedOperationIds: ["safe:create"],
      dependencyOperationIds: [],
      rejectedOperationIds: [],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 0,
      manifestDigest: "a".repeat(64),
      approvalMode: "automatic_safe",
      approvalModeVersion: 1,
    });

    expect(inserted).toMatchObject({
      approvalMode: "automatic_safe",
      approvalModeVersion: 1,
    });
  });

  it("publishes manifest rows, phase, digest, and digest version in the same organizer transaction", async () => {
    let published: Record<string, unknown> | undefined;
    let transactionCommitted = false;
    const transaction = {
      select: () => {
        const chain = {
          from: () => chain, where: () => chain, limit: () => chain,
          for: async () => [{ id: "run" }],
        };
        return chain;
      },
      delete: () => ({ where: async () => {} }),
      update: () => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({ returning: async () => {
            expect(transactionCommitted).toBe(false);
            published = values;
            return [{ id: "run" }];
          } }),
        }),
      }),
    };
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(transaction);
        transactionCommitted = true;
        return result;
      },
    } as never;

    await new DrizzleProductionOrganizerStore(database, { sourceDatabaseKey: "act-db" })
      .persistManifest("run", "claim-token", {
        digest: "a".repeat(64), operations: [], outcomes: [], diagnostics: [],
      });

    expect(transactionCommitted).toBe(true);
    expect(published).toMatchObject({
      phase: "ready_to_apply",
      manifestDigestVersion: "canonical-json-v1",
      manifestGeneration: "claim-token",
      organizerToken: null,
      organizerLeaseExpiresAt: null,
    });
  });

  it("reads organizer source context sequentially on a transaction client", async () => {
    let activeReads = 0;
    let maximumActiveReads = 0;
    const select = () => {
      const chain = {
        from: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        then: (resolve: (rows: unknown[]) => unknown, reject: (error: unknown) => unknown) => {
          activeReads += 1;
          maximumActiveReads = Math.max(maximumActiveReads, activeReads);
          return new Promise<unknown[]>((done) => setTimeout(() => done([]), 1))
            .then((rows) => {
              activeReads -= 1;
              return resolve(rows);
            }, reject);
        },
      };
      return chain;
    };
    const database = { select } as never;

    await new DrizzleProductionOrganizerStore(database, { sourceDatabaseKey: "act-db" })
      .loadSources("run");

    expect(maximumActiveReads).toBe(1);
  });

  it("scopes manifest publication reads to both the source database and owner", async () => {
    let selectedTable: unknown;
    let runPredicate: unknown;
    const database = {
      select: () => {
        const rows = () =>
          selectedTable === actReplacementRuns
            ? [{ summary: { manifestDigest: "digest-owned" } }]
            : [];
        const chain = {
          from: (table: unknown) => {
            selectedTable = table;
            return chain;
          },
          where: (predicate: unknown) => {
            if (selectedTable === actReplacementRuns) runPredicate = predicate;
            return chain;
          },
          limit: async () => rows(),
          then: (resolve: (value: unknown[]) => unknown) => resolve(rows()),
        };
        return chain;
      },
    } as never;

    await expect(
      new DrizzleActReviewReader(database, {
        sourceDatabaseKey: "act-db",
        requestedBy: "owner",
      }).getManifest("run"),
    ).resolves.toMatchObject({ operations: [], outcomes: [] });

    const rendered = new PgDialect().sqlToQuery(runPredicate as never);
    expect(rendered.params).toEqual(
      expect.arrayContaining(["run", "act-db", "owner"]),
    );
  });

  it("loads durable manifest row sets sequentially on a transaction client", async () => {
    let activeRowReads = 0;
    let maximumConcurrentRowReads = 0;
    const database = {
      select: () => {
        let selectedTable: unknown;
        const rows = () => selectedTable === actReplacementRuns
          ? [{ summary: { manifestDigest: "digest-owned" } }]
          : [];
        const chain = {
          from: (table: unknown) => { selectedTable = table; return chain; },
          where: () => chain,
          limit: async () => rows(),
          then: async (resolve: (value: unknown[]) => unknown) => {
            activeRowReads += 1;
            maximumConcurrentRowReads = Math.max(maximumConcurrentRowReads, activeRowReads);
            await Promise.resolve();
            activeRowReads -= 1;
            return resolve(rows());
          },
        };
        return chain;
      },
    } as never;

    await new DrizzleActReviewReader(database, {
      sourceDatabaseKey: "act-db",
      requestedBy: "owner",
    }).getManifest("run");

    expect(maximumConcurrentRowReads).toBe(1);
  });

  it("aggregates globally, pages in SQL, and loads payloads only for page sources", async () => {
    const queries: unknown[] = [];
    const responses = [
      [{
        manifestDigest: "digest-sql",
        decisionRequired: 0,
        archivedOnly: 5,
        issueCounts: {
          ambiguous_match: 1,
          field_conflict: 1,
          relationship_unresolved: 1,
          unassigned: 1,
          unsupported_record: 1,
        },
        diagnosticCounts: { unsupported_field: 50 },
      }],
      [{ total: 1, filteredIssueCounts: { field_conflict: 1 } }],
      [{
        sourceRecordId: "source-on-page",
        sourceVersionId: "version-on-page",
        state: "awaiting_review",
        issues: [{ code: "field_conflict", reason: "phone" }],
        candidates: [],
        match: { kind: "exact", localId: "local-organization" },
        operationKeys: ["organization:source-on-page"],
        streamType: "company",
        rawSnapshot: { Name: "Acme", token: "never-return-this" },
      }],
      [{
        sourceRecordId: "source-on-page",
        operationKey: "organization:source-on-page",
        targetType: "organization",
        action: "link_existing",
        payload: {
          normalized: { kind: "organization", name: "Acme", phone: "555-ACT" },
          localId: "local-organization",
          rawSnapshot: "never-return-this",
        },
      }],
      [{
        id: "local-organization",
        entityType: "organization",
        label: "Acme",
        detail: "Chicago, IL",
        fields: { phone: "555-LOCAL" },
      }],
    ];
    const database = {
      execute: async (query: unknown) => {
        queries.push(query);
        return { rows: responses.shift() ?? [] };
      },
    } as never;

    const page = await new DrizzleActReviewReader(database, {
      sourceDatabaseKey: "act-db",
      requestedBy: "owner",
    })
      .readReviewPage({ runId: "run", issue: "field_conflict", page: 2, pageSize: 25 });

    expect(page).toMatchObject({
      total: 1,
      manifestDigest: "digest-sql",
      summary: {
        decisionRequired: 0,
        archivedOnly: 5,
        diagnosticCounts: { unsupported_field: 50 },
      },
      filteredIssueCounts: { field_conflict: 1 },
      rows: [{
        sourceRecordId: "source-on-page",
        display: { Name: "Acme" },
        conflicts: [{
          fieldName: "phone",
          localValue: "555-LOCAL",
          sourceValue: "555-ACT",
          target: { id: "local-organization", entityType: "organization", label: "Acme", detail: "Chicago, IL" },
          reviewToken: {
            sourceRecordId: "source-on-page",
            sourceVersionId: "version-on-page",
            fieldName: "phone",
            sourceValueFingerprint: fingerprintSourceContent({ value: "555-ACT" }),
            targetEntityType: "organization",
            targetEntityId: "local-organization",
            localValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL" }),
          },
        }],
      }],
    });
    expect(JSON.stringify(page)).not.toContain("never-return-this");

    const rendered = queries.map((query) => new PgDialect().sqlToQuery(query as never));
    expect(rendered[0]?.sql).toContain("jsonb_array_elements");
    expect(rendered[0]?.sql).toContain("count(distinct");
    expect(rendered[0]?.sql).toContain('0::int as "decisionRequired"');
    expect(rendered[0]?.sql).toContain('as "archivedOnly"');
    expect(rendered[0]?.params).toEqual(expect.arrayContaining(["awaiting_review", "unassigned", "unsupported"]));
    expect(rendered[0]?.params).toContain("owner");
    expect(rendered[1]?.sql).toContain("count(*)");
    expect(rendered[1]?.params).toContain("owner");
    expect(rendered[2]?.sql).toContain("limit");
    expect(rendered[2]?.sql).toContain("offset");
    expect(rendered[2]?.params).toEqual(expect.arrayContaining([25, 25]));
    expect(rendered[2]?.params).toContain("owner");
    expect(rendered[3]?.params).toContain("source-on-page");
    expect(rendered[3]?.params).not.toContain("source-off-page");
  });

  it("searches only stream-allowlisted display fields, never the full raw snapshot", async () => {
    const queries: unknown[] = [];
    const responses = [
      [{ manifestDigest: "digest-search", decisionRequired: 0, archivedOnly: 0, issueCounts: {}, diagnosticCounts: {} }],
      [{ total: 0, filteredIssueCounts: {} }],
      [],
    ];
    const database = {
      execute: async (query: unknown) => {
        queries.push(query);
        return { rows: responses.shift() ?? [] };
      },
    } as never;

    await new DrizzleActReviewReader(database, {
      sourceDatabaseKey: "act-db",
      requestedBy: "owner",
    })
      .readReviewPage({ runId: "run", search: "hidden-token", pageSize: 25 });

    const countQuery = new PgDialect().sqlToQuery(queries[1] as never);
    const pageQuery = new PgDialect().sqlToQuery(queries[2] as never);
    for (const rendered of [countQuery, pageQuery]) {
      expect(rendered.sql).toContain("jsonb_each");
      expect(rendered.sql).not.toContain('"act_source_record_versions"."raw_snapshot"::text');
      expect(rendered.params).toContain("name");
      expect(rendered.sql).toContain(`lower(display_field.key) in (`);
      expect(rendered.params).not.toContain("authorization");
      expect(rendered.params).toContain("%hidden-token%");
    }
  });

  it("limits assignment target search to owner-visible entity types and 25 rows", async () => {
    const queries: unknown[] = [];
    const database = {
      execute: async (query: unknown) => {
        queries.push(query);
        return { rows: [{ id: "contact-1", entityType: "contact", label: "Taako Taaco", detail: "taako@example.com" }] };
      },
    } as never;
    const reader = new DrizzleActReviewReader(database, {
      sourceDatabaseKey: "act-db",
      requestedBy: "owner",
    });

    await expect(reader.listAssignmentTargets({ search: "  TAAKO   TAACO ", entityType: "contact" }))
      .resolves.toEqual([{ id: "contact-1", entityType: "contact", label: "Taako Taaco", detail: "taako@example.com" }]);

    const rendered = new PgDialect().sqlToQuery(queries[0] as never);
    expect(rendered.sql).toContain("limit");
    expect(rendered.params).toContain(25);
    expect(rendered.params).toContain("contact");
    expect(rendered.params).toContain("%taako taaco%");
    expect(rendered.sql).not.toContain("act_source_record_versions");
    const whereClause = rendered.sql.slice(rendered.sql.indexOf("where"), rendered.sql.indexOf("order by"));
    expect(whereClause).not.toContain("detail");
    expect(rendered.sql).toContain("regexp_replace(trim(label)");
    expect(rendered.sql).toContain('order by lower(regexp_replace(trim(label)');

    await reader.listAssignmentTargets({ entityTypes: ["organization", "contact", "booking"] });
    const multiTypeQuery = new PgDialect().sqlToQuery(queries[1] as never);
    expect(multiTypeQuery.sql).toContain("union all");
    expect(multiTypeQuery.params).toEqual(expect.arrayContaining(["organization", "contact", "booking", 25]));
    expect(multiTypeQuery.params).not.toContain("calling_list");
    expect(multiTypeQuery.params).not.toContain("activity");

    await reader.listAssignmentTargets({ search: "%", entityType: "contact" });
    await reader.listAssignmentTargets({ search: "_", entityType: "contact" });
    const percentQuery = new PgDialect().sqlToQuery(queries[2] as never);
    const underscoreQuery = new PgDialect().sqlToQuery(queries[3] as never);
    expect(percentQuery.params).toContain("%\\%%");
    expect(underscoreQuery.params).toContain("%\\_%");
    expect(percentQuery.sql).toContain("escape");
    expect(underscoreQuery.sql).toContain("escape");

    const queryCount = queries.length;
    await expect(reader.listAssignmentTargets({ entityType: "private_record" })).resolves.toEqual([]);
    expect(queries).toHaveLength(queryCount);
  });

  it("bounds manifest writes so large imports do not issue one query per record", () => {
    expect(manifestWriteBatches(Array.from({ length: 501 }, (_, index) => index)))
      .toEqual([
        Array.from({ length: 250 }, (_, index) => index),
        Array.from({ length: 250 }, (_, index) => index + 250),
        [500],
      ]);
  });

  it("reconciles stale manifest operations without deleting terminal history", () => {
    const rendered = new PgDialect().sqlToQuery(staleNonterminalOperationPredicate("run-1", ["current-operation"]) as never);

    expect(rendered.params).toEqual(expect.arrayContaining(["run-1", "current-operation", "applied", "already_present"]));
    expect(rendered.sql).toContain("not in");
  });

  it("selects only operation rows belonging to the published manifest generation", () => {
    const generation = "00000000-0000-4000-8000-000000000123";
    const rendered = new PgDialect().sqlToQuery(
      currentManifestOperationPredicate("run-1", generation) as never,
    );

    expect(rendered.sql).toContain("manifest_generation");
    expect(rendered.params).toEqual(["run-1", generation]);
  });

  it("rejects semantic mutation behind a reused terminal operation key", () => {
    const operation = {
      sourceRecordId: "source-1", sourceVersionId: "version-1", targetType: "organization" as const,
      action: "fill_missing" as const, payload: { fieldName: "phone", value: "111" },
      dependencyOperationKeys: ["identity-1"], requiredForSourceOutcome: true, safeByDefault: true,
    };

    expect(operationSemanticsMatch(operation, operation)).toBe(true);
    expect(operationSemanticsMatch(operation, { ...operation, payload: { fieldName: "phone", value: "222" } })).toBe(false);
    expect(operationSemanticsMatch(operation, { ...operation, dependencyOperationKeys: ["identity-2"] })).toBe(false);
  });

  it("accepts dependency-only changes when rebuilding a terminal identity root", () => {
    const previousIdentity = {
      sourceRecordId: "source-1", sourceVersionId: "version-1", targetType: "activity" as const,
      action: "create" as const, payload: { normalized: { kind: "timeline", regarding: "Called venue" } },
      dependencyOperationKeys: ["organization:parent-1"], requiredForSourceOutcome: true, safeByDefault: true,
    };
    const rebuiltIdentity = { ...previousIdentity, dependencyOperationKeys: [] };

    expect(operationSemanticsMatch(previousIdentity, rebuiltIdentity)).toBe(true);
  });

  it("claims a completed run only through an explicit review-required outcome predicate", async () => {
    let whereClause: unknown;
    const database = {
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            whereClause = condition;
            return { returning: async () => [] };
          },
        }),
      }),
    } as never;

    await new DrizzleProductionOrganizerStore(database, { sourceDatabaseKey: "act-db" }).claim("run-complete");
    const rendered = new PgDialect().sqlToQuery(sql`${whereClause as never}`);
    expect(rendered.sql).toContain("exists");
    expect(rendered.params).toEqual(expect.arrayContaining([
      "complete", "awaiting_review", "unassigned", "unsupported",
    ]));
  });

  it("reclaims a ready run before apply or when its legacy plan needs versioning", async () => {
    let whereClause: unknown;
    const database = {
      update: () => ({
        set: () => ({
          where: (condition: unknown) => {
            whereClause = condition;
            return { returning: async () => [] };
          },
        }),
      }),
    } as never;

    await new DrizzleProductionOrganizerStore(database, { sourceDatabaseKey: "act-db" }).claim("run-ready");
    const rendered = new PgDialect().sqlToQuery(sql`${whereClause as never}`);

    expect(rendered.sql).toContain("act_replacement_apply_batches");
    expect(rendered.sql).toContain("act_replacement_apply_operations");
    expect(rendered.sql.match(/not exists/g)).toHaveLength(3);
    expect(rendered.sql).toContain("manifest_generation");
    expect(rendered.params).toEqual(expect.arrayContaining(["ready_to_apply", "pending"]));
    const readyParameter = `$${rendered.params.indexOf("ready_to_apply") + 1}`;
    expect(rendered.sql).toContain(`"act_replacement_runs"."phase" = ${readyParameter} and not exists`);
  });

  it("discovers only expired organizing runs for automatic recovery", async () => {
    let whereClause: unknown;
    const chain = {
      from: () => chain,
      where: (condition: unknown) => { whereClause = condition; return chain; },
      limit: async () => [],
    };
    const database = { select: () => chain } as never;
    const now = new Date("2026-08-08T20:00:00.000Z");

    await new DrizzleProductionOrganizerStore(database, { sourceDatabaseKey: "act-db" })
      .findRecoverableRunId(now);

    const rendered = new PgDialect().sqlToQuery(sql`${whereClause as never}`);
    expect(rendered.params).toEqual(
      expect.arrayContaining(["act-db", "organizing", now.toISOString()]),
    );
  });

  it("supersedes a production decision with a non-UUID owner identity", async () => {
    let supersededBy: unknown;
    const source = {
      id: "source-1", latestVersionId: "version-1", streamType: "company", actRecordId: "ACT-1",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "source-1", sourceVersionId: "version-1",
      scope: "duplicate_identity", decision: "keep_separate", requestKey: "decision-key",
      fieldName: null, targetEntityType: null, targetEntityId: null, active: false,
    };
    const database = {
      select: () => {
        const chain = {
          from: () => chain,
          leftJoin: () => chain,
          where: () => chain,
          limit: async () => [{ source, version: null }],
        };
        return chain;
      },
      update: () => ({
        set: (values: { supersededBy?: unknown }) => {
          supersededBy = values.supersededBy;
          const chain = { where: () => chain, returning: async () => [decision] };
          return chain;
        },
      }),
    } as never;
    const applyService = {} as never;
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, applyService);

    await expect(store.supersedeDecision("source-1", "decision-1", "user_owner_123", "remove-key"))
      .resolves.toMatchObject({ id: "decision-1", active: false });
    expect(supersededBy).toBe("user_owner_123");
  });

  it("replays the stored actor for an idempotent decision write", async () => {
    const prior = {
      id: "decision-1", sourceRecordId: "source-1", sourceVersionId: "version-1",
      scope: "field_conflict", decision: "keep_local", requestKey: "decision-key", fieldName: "phone",
      relationshipSlot: null, targetEntityType: null, targetEntityId: null, decidedBy: "original-owner", active: true,
      requestFingerprint: individualDecisionRequestFingerprint({
        sourceRecordId: "source-1", sourceVersionId: "version-1", scope: "field_conflict", decision: "keep_local",
        fieldName: "phone", relationshipSlot: null, targetEntityType: null,
        targetEntityId: null, decidedBy: "original-owner",
      }),
    };
    const database = {
      select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => { table = value; return chain; },
          leftJoin: () => chain,
          where: () => chain,
          limit: async () => table === actReplacementReviewDecisions ? [prior] : [],
        };
        return chain;
      },
    } as never;
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.saveDecision({
      sourceRecordId: "source-1", sourceVersionId: "version-1", scope: "field_conflict", decision: "keep_local",
      requestKey: "decision-key", fieldName: "phone", targetEntityType: null, targetEntityId: null, decidedBy: "original-owner",
    })).resolves.toMatchObject({ id: "decision-1", decidedBy: "original-owner" });
  });

  it("commits a review mutation before starting the memory-heavy manifest rebuild", async () => {
    const events: string[] = [];
    const transaction = {};
    let transactionOptions: unknown;
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>, options: unknown) => {
        transactionOptions = options;
        events.push("transaction:start");
        const result = await callback(transaction);
        events.push("transaction:commit");
        return result;
      },
    } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveAssignment")
      .mockImplementation(async (input) => {
        events.push("assignment:save");
        return { id: "assignment-1", ...input } as never;
      });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockImplementation(async () => {
        events.push("manifest:rebuild");
        return { status: "ready_to_apply", manifest: { digest: "digest", diagnostics: [], outcomes: [], operations: [] } };
      });

    await new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .saveAssignmentAndRebuild("run", {
        sourceRecordId: "source-1",
        sourceVersionId: "version-1",
        targetEntityType: "organization",
        targetEntityId: "organization-1",
        assignedBy: "owner",
        requestKey: "assignment-key",
        role: "primary",
        isPrimary: true,
        manualAuthority: true,
      });

    expect(events).toEqual([
      "transaction:start",
      "assignment:save",
      "transaction:commit",
      "manifest:rebuild",
    ]);
  });

  it("rebuilds an exact durable individual replay after current source applicability validation is skipped", async () => {
    const input = {
      runId: "run", sourceRecordId: "source-1", sourceVersionId: "version-1",
      scope: "field_conflict" as const, decision: "keep_local" as const,
      requestKey: "decision-key", fieldName: "phone", relationshipSlot: null,
      targetEntityType: null, targetEntityId: null, decidedBy: "owner",
    };
    const prior = {
      id: "decision-1", ...input, runId: undefined, active: true,
      requestFingerprint: individualDecisionRequestFingerprint(input),
    };
    const events: string[] = [];
    const transaction = {
      execute: async () => {
        events.push("source:lock");
        return { rows: [{ sourceRecordId: "source-1", sourceVersionId: "version-2", streamType: "company" }] };
      },
      select: () => {
        let table: unknown;
        const rows = () => {
          if (table === actReplacementRuns) return [{ id: "run", requestedBy: "owner" }];
          if (table === actReplacementReviewDecisions) return [prior];
          if (table === actSourceRecords) return [{
            source: { id: "source-1", latestVersionId: "version-2", streamType: "company", actRecordId: "ACT-1" },
            version: null,
          }];
          return [];
        };
        const chain = {
          from: (value: unknown) => { table = value; return chain; },
          leftJoin: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => rows(),
          then: (resolve: (value: unknown[]) => unknown) => resolve(rows()),
        };
        return chain;
      },
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
    } as never;
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockResolvedValue({ status: "ready_to_apply", manifest: { digest: "digest", diagnostics: [], outcomes: [], operations: [] } });

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .saveDecisionAndRebuild("run", input)).resolves.toMatchObject({ id: "decision-1", sourceVersionId: "version-1" });
    expect(rebuild).toHaveBeenCalledOnce();
    expect(events).toEqual(["source:lock"]);
  });

  it("rejects a duplicate link when its locked existing target does not exist", async () => {
    const input = {
      runId: "run", sourceRecordId: "source-1", sourceVersionId: "version-1",
      scope: "duplicate_identity" as const, decision: "link_existing" as const,
      requestKey: "link-missing", fieldName: null, relationshipSlot: null,
      targetEntityType: "organization", targetEntityId: "missing-target", decidedBy: "owner",
    };
    const inserted = { id: "decision-created-without-validation", ...input, runId: undefined, active: true, requestFingerprint: individualDecisionRequestFingerprint(input) };
    const transaction = {
      execute: async () => ({ rows: [{ sourceRecordId: "source-1", sourceVersionId: "version-1", streamType: "company" }] }),
      select: () => {
        let table: unknown;
        const rows = () => {
          if (table === actReplacementRuns) return [{ id: "run", requestedBy: "owner" }];
          if (table === actSourceRecords) return [{
            source: { id: "source-1", latestVersionId: "version-1", streamType: "company", actRecordId: "ACT-1" },
            version: null,
          }];
          return [];
        };
        const chain = {
          from: (value: unknown) => { table = value; return chain; },
          leftJoin: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => rows(),
          then: (resolve: (value: unknown[]) => unknown) => resolve(rows()),
        };
        return chain;
      },
      insert: () => ({ values: () => ({ returning: async () => [inserted] }) }),
    };
    const database = { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest").mockResolvedValue({
      digest: "digest", diagnostics: [], operations: [],
      outcomes: [{
        sourceRecordId: "source-1", sourceVersionId: "version-1", state: "awaiting_review",
        issues: [{ code: "ambiguous_match", reason: "multiple_candidates" }],
        candidates: [{ candidateId: "missing-target" }], match: { kind: "ambiguous", candidateIds: ["missing-target"] },
        mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
      }],
    });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockResolvedValue({
      status: "ready_to_apply",
      manifest: { digest: "digest", diagnostics: [], operations: [], outcomes: [] },
    });

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .saveDecisionAndRebuild("run", input)).rejects.toMatchObject({ code: "review_target_not_found", status: 409 });
  });

  it("locks the current digest and saves a bulk decision transaction with one rebuild", async () => {
    const events: string[] = [];
    let locked = false;
    let selects = 0;
    const transaction = {
      select: () => {
        selects += 1;
        const selectNumber = selects;
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async (mode: string) => {
            locked = mode === "update";
            events.push("lock");
            return [{ summary: { manifestDigest: "digest-1" } }];
          },
          then: (resolve: (rows: unknown[]) => unknown) => {
            events.push(selectNumber === 2 ? "request:check" : "decision-key:check");
            return resolve([]);
          },
        };
        return chain;
      },
      insert: () => ({ values: async () => { events.push("request:save"); } }),
      execute: async () => {
        events.push("sources:lock");
        return { rows: [
          { sourceRecordId: "a", sourceVersionId: "v-a", streamType: "company" },
          { sourceRecordId: "b", sourceVersionId: "v-b", streamType: "company" },
        ] };
      },
    };
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        events.push("transaction:start");
        const result = await callback(transaction);
        events.push("transaction:commit");
        return result;
      },
      update: () => ({
        set: () => ({
          where: async () => { events.push("request:update"); },
        }),
      }),
    } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision")
      .mockImplementation(async (input) => {
        events.push(`save:${input.sourceRecordId}:${input.decidedBy}`);
        return { ...input, id: `decision-${input.sourceRecordId}`, active: true };
      });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockImplementation(async () => {
        events.push("rebuild");
        return { status: "ready_to_apply", manifest: { digest: "digest-2", diagnostics: [], outcomes: [], operations: [] } };
      });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest")
      .mockImplementation(async () => {
        events.push("manifest");
        return unsupportedBulkManifest([
          { sourceRecordId: "a", sourceVersionId: "v-a" },
          { sourceRecordId: "b", sourceVersionId: "v-b" },
        ]);
      });
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    const result = await store.saveDecisionsAndRebuild("run", {
      expectedManifestDigest: "digest-1",
      owner: "authenticated-owner",
      requestKey: "bulk",
      requestFingerprint: "fingerprint",
      ...unsupportedBulkStoreInput([
        { sourceRecordId: "a", sourceVersionId: "v-a" },
        { sourceRecordId: "b", sourceVersionId: "v-b" },
      ]),
    });

    expect(locked).toBe(true);
    expect(result).toMatchObject({ manifestDigest: "digest-2", decisions: [{ decidedBy: "authenticated-owner" }, { decidedBy: "authenticated-owner" }] });
    expect(events).toEqual([
      "transaction:start", "lock", "request:check", "sources:lock", "manifest", "decision-key:check",
      "save:a:authenticated-owner", "save:b:authenticated-owner", "request:save", "transaction:commit",
      "rebuild", "request:update",
    ]);
  });

  it("persists heterogeneous automatic decisions from one protected transaction and rebuilds once", async () => {
    const events: string[] = [];
    const protectedDigest = "a".repeat(64);
    let selectNumber = 0;
    let transactionOptions: unknown;
    const transaction = {
      select: () => {
        selectNumber += 1;
        const currentSelect = selectNumber;
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async (mode: string) => {
            events.push(`run:${mode}`);
            return [{
              summary: { manifestDigest: protectedDigest },
              manifestDigestVersion: "canonical-json-v1",
              manifestGeneration: "11111111-1111-4111-8111-111111111111",
              phase: "ready_to_apply",
            }];
          },
          then: (resolve: (rows: unknown[]) => unknown) => {
            events.push(currentSelect === 2 ? "request:check" : "decision-key:check");
            return resolve([]);
          },
        };
        return chain;
      },
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("act_replacement_bulk_review_requests")) return { rows: [] };
        if (!rendered.includes("act_source_records")) {
          events.push("targets:search");
          return { rows: [] };
        }
        events.push("sources:lock");
        return { rows: [
          { sourceRecordId: "ambiguous", sourceVersionId: "v-ambiguous", streamType: "contact" },
          { sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", streamType: "custom" },
        ] };
      },
      insert: () => ({ values: async () => { events.push("request:save"); } }),
    };
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>, options: unknown) => {
        transactionOptions = options;
        events.push("transaction:start");
        const result = await callback(transaction);
        events.push("transaction:commit");
        return result;
      },
      update: () => ({
        set: () => ({ where: async () => { events.push("request:update"); } }),
      }),
      execute: async () => { events.push("request:update"); return { rows: [{ id: "request" }] }; },
    } as never;
    const manifest = {
      digest: protectedDigest,
      diagnostics: [],
      operations: [],
      outcomes: [
        {
          sourceRecordId: "ambiguous", sourceVersionId: "v-ambiguous", state: "awaiting_review" as const,
          issues: [{ code: "ambiguous_match", reason: "multiple_candidates" }], candidates: [],
          match: { kind: "ambiguous", candidateIds: [] }, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
        },
        {
          sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", state: "unsupported" as const,
          issues: [{ code: "unsupported_record", reason: "normalization_failed" }], candidates: [],
          match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
        },
      ],
    };
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest")
      .mockRejectedValue(new Error("durable_manifest_copy_forbidden_for_generated_manifest"));
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifestDigest")
      .mockRejectedValue(new Error("durable_manifest_digest_copy_forbidden_for_generated_manifest"));
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest")
      .mockImplementation(async () => {
        events.push("manifest:protected");
        return manifest;
      });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "listSources")
      .mockResolvedValue([
        { sourceRecordId: "ambiguous", sourceVersionId: "v-ambiguous", streamType: "contact", display: { FirstName: "New", LastName: "Person" } },
        { sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", streamType: "custom", display: { Name: "Legacy row" } },
      ]);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision")
      .mockImplementation(async (input) => {
        events.push(`decision:${input.scope}:${input.decision}`);
        return { ...input, id: `decision-${input.sourceRecordId}`, active: true };
      });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockImplementation(async () => {
        events.push("rebuild");
        return { status: "ready_to_apply", manifest: { ...manifest, digest: "digest-2" } };
      });

    const result = await new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", {
        expectedManifestDigest: protectedDigest,
        owner: "owner",
        requestKey: "automatic-1",
        policyVersion: "2026-08-12",
      });

    expect(result).toEqual({ status: "processing" });
    expect(transactionOptions).toEqual({ isolationLevel: "serializable" });
    expect(events).toEqual([
      "transaction:start", "run:update", "request:check", "sources:lock", "manifest:protected", "targets:search",
      "decision-key:check", "decision:duplicate_identity:keep_separate", "decision:unsupported_record:ignore_source",
      "request:save", "transaction:commit",
    ]);
    expect(DrizzleActReviewCommandStore.prototype.rebuildAfterReviewChange).not.toHaveBeenCalled();
  });

  it("resolves generated automatic-review context in bounded source batches", async () => {
    const outcomes = Array.from({ length: 61 }, (_, index) => ({
      sourceRecordId: `source-${String(index).padStart(3, "0")}`,
      sourceVersionId: `version-${index}`,
      state: "awaiting_review" as const,
      issues: [{ code: "unassigned", reason: "no_resolved_parent" }],
      candidates: [],
      match: null,
      mappingWarnings: [],
      unsupportedFieldPaths: [],
      operationKeys: [],
    }));
    const manifest = { digest: "digest", diagnostics: [], operations: [], outcomes };
    let largestSourceBatch = 0;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "listSources")
      .mockImplementation(async (_runId, sourceRecordIds) => {
        const ids = sourceRecordIds ?? [];
        largestSourceBatch = Math.max(largestSourceBatch, ids.length);
        if (ids.length > 25) throw new Error("automatic_review_source_batch_unbounded");
        return ids.map((sourceRecordId) => {
          const outcome = outcomes.find((candidate) => candidate.sourceRecordId === sourceRecordId)!;
          return {
            sourceRecordId,
            sourceVersionId: outcome.sourceVersionId,
            streamType: "history",
            display: { Regarding: `History ${sourceRecordId}` },
          };
        });
      });
    const store = new DrizzleActReviewCommandStore({ execute: async () => ({ rows: [] }) } as never, {
      sourceDatabaseKey: "act-db",
    }, {} as never) as unknown as {
      proposeProtectedAutomaticReview(runId: string, value: typeof manifest): Promise<{ proposals: unknown[] }>;
    };

    const result = await store.proposeProtectedAutomaticReview("run", manifest);
    expect(result.proposals).toHaveLength(61);
    expect(largestSourceBatch).toBeGreaterThan(0);
    expect(largestSourceBatch).toBeLessThanOrEqual(25);
  });

  it("claims one pending automatic review and rebuilds it in a separate worker turn", async () => {
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "version-1",
      scope: "unsupported_record", decision: "ignore_source", requestKey: "automatic-1:1",
      requestFingerprint: "decision-fingerprint", fieldName: null, relationshipSlot: null,
      targetEntityType: null, targetEntityId: null, reviewedSourceValue: null,
      reviewedSourceValueFingerprint: null, reviewedLocalValue: null,
      reviewedLocalValueFingerprint: null, active: true, supersededAt: null,
      supersededBy: null, decidedBy: "owner", createdAt: new Date(),
    };
    let claimCount = 0;
    let finalizeCount = 0;
    const database = {
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("with candidate as")) {
          claimCount += 1;
          return { rows: [{
            runId: "run", requestKey: "automatic-1", requestFingerprint: "request-fingerprint",
            requestedBy: "owner", expectedManifestDigest: "digest-before",
            automaticSummary: {}, decisionIds: [decision.id],
          }] };
        }
        if (rendered.includes("set manifest_digest")) {
          finalizeCount += 1;
          return { rows: [{ id: "request" }] };
        }
        if (rendered.includes("set rebuild_lease_expires_at")) return { rows: [{ id: "request" }] };
        return { rows: [] };
      },
      select: () => {
        const chain = { from: () => chain, where: async () => [decision] };
        return chain;
      },
    } as never;
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockResolvedValue({
        status: "ready_to_apply",
        manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] },
      });

    const result = await new DrizzleActReviewCommandStore(
      database, { sourceDatabaseKey: "act-db" }, {} as never,
    ).recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() });

    expect(result).toEqual({ kind: "progress" });
    expect(claimCount).toBe(1);
    expect(rebuild).toHaveBeenCalledOnce();
    expect(finalizeCount).toBe(1);
  });

  it("records an all-manual automatic replay without rebuilding an unchanged manifest", async () => {
    let selectNumber = 0;
    const transaction = {
      select: () => {
        selectNumber += 1;
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => [{ summary: { manifestDigest: "digest-manual" } }],
          then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
        };
        return chain;
      },
      execute: async () => ({ rows: [{ sourceRecordId: "required", sourceVersionId: "v-required", streamType: "contact" }] }),
      insert: () => ({ values: async () => {} }),
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    } as never;
    const manifest = {
      digest: "digest-manual", diagnostics: [], operations: [],
      outcomes: [{
        sourceRecordId: "required", sourceVersionId: "v-required", state: "awaiting_review" as const,
        issues: [{
          code: "relationship_unresolved", reason: "required_parent_missing", relationshipSlot: "required-parent",
          expectedParentTypes: ["organization"], canImportStandalone: false,
        }],
        candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
      }],
    };
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(manifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "listSources").mockResolvedValue([
      { sourceRecordId: "required", sourceVersionId: "v-required", streamType: "contact", display: { FirstName: "Needs", LastName: "Parent" } },
    ]);
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", {
        expectedManifestDigest: "digest-manual", owner: "owner", requestKey: "manual-only", policyVersion: "2026-08-12",
      })).resolves.toMatchObject({ decisions: [], manifestDigest: "digest-manual", reviewedOperationIds: [] });
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("recovers a pending automatic request from stored decisions without inserting duplicates", async () => {
    const input = {
      expectedManifestDigest: "digest-before", owner: "owner", requestKey: "automatic-recovery", policyVersion: "2026-08-12",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "v-unsupported",
      scope: "unsupported_record" as const, decision: "ignore_source" as const,
      requestKey: "automatic-recovery:1", requestFingerprint: "individual-fingerprint",
      fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null,
      reviewedSourceValue: null, reviewedSourceValueFingerprint: null,
      reviewedLocalValue: null, reviewedLocalValueFingerprint: null,
      decidedBy: "owner", active: true, supersededAt: null, supersededBy: null, createdAt: new Date(),
    };
    const request: Record<string, unknown> = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [decision],
      }),
      requestedBy: "owner", decisionIds: [decision.id],
      manifestDigest: "__pending_review_rebuild__", reviewedOperationIds: [],
    };
    const transaction = {
      select: () => {
        let table: unknown;
        const rows = () => table === actReplacementRuns
          ? [{ summary: { manifestDigest: "digest-before" } }]
          : table === actReplacementReviewDecisions
            ? [decision]
            : [request];
        const chain = {
          from: (value: unknown) => { table = value; return chain; },
          where: () => chain,
          limit: () => chain,
          for: async () => rows(),
          then: (resolve: (value: unknown[]) => unknown) => resolve(rows()),
        };
        return chain;
      },
      update: () => ({
        set: (values: Record<string, unknown>) => ({ where: async () => { Object.assign(request, values); } }),
      }),
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("select expected_manifest_digest")) return { rows: [{
          expectedManifestDigest: input.expectedManifestDigest, automaticSummary: automaticReviewSummaryFromDecisions([decision as never]),
          rebuildState: request.rebuildState ?? "pending", rebuildToken: request.rebuildToken ?? null,
          rebuildLeaseExpiresAt: request.rebuildLeaseExpiresAt ?? null,
        }] };
        Object.assign(request, { rebuildState: "rebuilding", rebuildToken: "lease", rebuildLeaseExpiresAt: new Date(Date.now() + 60_000) });
        return { rows: [] };
      },
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      select: transaction.select,
      update: () => ({
        set: (values: { manifestDigest: string; reviewedOperationIds: string[] }) => ({
          where: async () => { Object.assign(request, values); },
        }),
      }),
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("with candidate as")) return { rows: [{
          runId: "run", requestKey: input.requestKey, requestFingerprint: request.requestFingerprint,
          requestedBy: input.owner, expectedManifestDigest: input.expectedManifestDigest,
          automaticSummary: automaticReviewSummaryFromDecisions([decision as never]), decisionIds: [decision.id],
        }] };
        Object.assign(request, { manifestDigest: "digest-after", reviewedOperationIds: [], rebuildState: "complete" });
        return { rows: [{ id: "request" }] };
      },
    } as never;
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision");
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockResolvedValue({
      status: "ready_to_apply",
      manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] },
    });

    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);
    await expect(store.resolveAutomaticReviewAndRebuild("run", input)).resolves.toEqual({ status: "processing" });
    await expect(store.recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() }))
      .resolves.toEqual({ kind: "progress" });
    const replay = await store.resolveAutomaticReviewAndRebuild("run", input);
    expect(replay).toMatchObject({
        status: "complete",
        decisions: [{ id: "decision-1" }], manifestDigest: "digest-after",
        summary: { unsupportedIgnored: 1, decisionsCreatedOrReplayed: 1 },
      });
    expect(save).not.toHaveBeenCalled();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it("allows only one concurrent pending recovery to rebuild while the other replays", async () => {
    const input = {
      expectedManifestDigest: "digest-before", owner: "owner", requestKey: "automatic-concurrent", policyVersion: "2026-08-12",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "v-unsupported",
      scope: "unsupported_record" as const, decision: "ignore_source" as const,
      requestKey: "automatic-concurrent:1", requestFingerprint: "individual-fingerprint",
      fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null,
      reviewedSourceValue: null, reviewedSourceValueFingerprint: null,
      reviewedLocalValue: null, reviewedLocalValueFingerprint: null,
      decidedBy: "owner", active: true, supersededAt: null, supersededBy: null, createdAt: new Date(),
    };
    const request: Record<string, unknown> = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [decision],
      }),
      requestedBy: "owner", decisionIds: [decision.id], manifestDigest: "__pending_review_rebuild__",
      expectedManifestDigest: input.expectedManifestDigest, reviewedOperationIds: [], rebuildState: "pending",
      rebuildToken: null, rebuildLeaseExpiresAt: null,
      automaticSummary: { ...automaticReviewSummaryFromDecisions([decision as never]), manualReview: 0 },
    };
    const rowsFor = (table: unknown) => table === actReplacementRuns
      ? [{ summary: { manifestDigest: "digest-before" } }]
      : table === actReplacementReviewDecisions ? [decision] : [request];
    const select = () => {
      let table: unknown;
      const chain = {
        from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
        for: async () => rowsFor(table), then: (resolve: (rows: unknown[]) => unknown) => resolve(rowsFor(table)),
      };
      return chain;
    };
    const transaction = {
      select,
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { Object.assign(request, values); } }) }),
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("select expected_manifest_digest")) return { rows: [{
          expectedManifestDigest: request.expectedManifestDigest, automaticSummary: request.automaticSummary,
          rebuildState: request.rebuildState, rebuildToken: request.rebuildToken,
          rebuildLeaseExpiresAt: request.rebuildLeaseExpiresAt,
        }] };
        Object.assign(request, { rebuildState: "rebuilding", rebuildToken: "lease", rebuildLeaseExpiresAt: new Date(Date.now() + 60_000) });
        return { rows: [] };
      },
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      select,
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { Object.assign(request, values); } }) }),
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("with candidate as")) {
          if (request.rebuildState !== "pending") return { rows: [] };
          request.rebuildState = "rebuilding";
          return { rows: [{
            runId: "run", requestKey: input.requestKey, requestFingerprint: request.requestFingerprint,
            requestedBy: input.owner, expectedManifestDigest: input.expectedManifestDigest,
            automaticSummary: request.automaticSummary, decisionIds: request.decisionIds,
          }] };
        }
        if (rendered.includes("select request_fingerprint")) return { rows: [request] };
        Object.assign(request, { manifestDigest: "digest-after", reviewedOperationIds: [], rebuildState: "complete" });
        return { rows: [{ id: "request" }] };
      },
    } as never;
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => { releaseRebuild = resolve; });
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockImplementation(async () => {
      await rebuildGate;
      return { status: "ready_to_apply", manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] } };
    });
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    const firstPromise = store.recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() });
    await vi.waitFor(() => expect(rebuild).toHaveBeenCalledOnce());
    const secondPromise = store.recoverOneAutomaticReview({ workerId: "worker-2", now: new Date() });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(rebuild).toHaveBeenCalledOnce();
    releaseRebuild();
    const [first, second] = await Promise.all([firstPromise, secondPromise]);
    expect(first).toEqual({ kind: "progress" });
    expect(second).toEqual({ kind: "idle" });
  });

  it("releases its rebuild lease after a known rejection so retry can reacquire immediately", async () => {
    const harness = pendingAutomaticRecoveryHarness();
    const failure = Object.assign(new Error("known_rebuild_failure"), { code: "known_rebuild_failure" });
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockRejectedValueOnce(failure)
      .mockResolvedValue({
        status: "ready_to_apply",
        manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] },
      });
    const store = new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() })).rejects.toBe(failure);
    expect(harness.request).toMatchObject({
      rebuildState: "pending", rebuildToken: null, rebuildLeaseExpiresAt: null,
    });
    await expect(store.recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() })).resolves.toEqual({ kind: "progress" });
    await expect(store.resolveAutomaticReviewAndRebuild("run", harness.input)).resolves.toMatchObject({
      status: "complete",
      manifestDigest: "digest-after", decisions: [{ id: "decision-1" }],
    });
    expect(rebuild).toHaveBeenCalledTimes(2);
  });

  it("logs only bounded automatic-review recovery metadata on success", async () => {
    const harness = pendingAutomaticRecoveryHarness();
    const info = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockResolvedValue({
        status: "ready_to_apply",
        manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] },
      });

    await new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
      .recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() });

    expect(info).toHaveBeenCalledWith({
      runId: "run",
      requestKey: "automatic-lease",
      requestFingerprint: harness.request.requestFingerprint,
      workerId: "worker-1",
      status: "complete",
    }, "Automatic review recovery completed");
  });

  it("logs an automatic-review failure code without the raw error", async () => {
    const harness = pendingAutomaticRecoveryHarness();
    const failure = Object.assign(new Error("private@example.com 555-0100"), {
      code: "manifest_rebuild_failed",
    });
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockRejectedValue(failure);

    await expect(new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
      .recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() })).rejects.toBe(failure);

    expect(error).toHaveBeenLastCalledWith({
      runId: "run",
      requestKey: "automatic-lease",
      requestFingerprint: harness.request.requestFingerprint,
      workerId: "worker-1",
      status: "failed",
      errorCode: "manifest_rebuild_failed",
    }, "Automatic review recovery failed");
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/private@example|555-0100/);
  });

  it.each([
    ["PII-bearing", "private@example.com_555-0100"],
    ["oversized", "x".repeat(65)],
  ])("replaces a %s automatic-review error code with a bounded fallback", async (_label, unsafeCode) => {
    const harness = pendingAutomaticRecoveryHarness();
    const failure = Object.assign(new Error("private@example.com 555-0100"), {
      code: unsafeCode,
    });
    const error = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockRejectedValue(failure);

    await expect(new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
      .recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() })).rejects.toBe(failure);

    expect(error).toHaveBeenLastCalledWith({
      runId: "run",
      requestKey: "automatic-lease",
      requestFingerprint: harness.request.requestFingerprint,
      workerId: "worker-1",
      status: "failed",
      errorCode: "automatic_review_failed",
    }, "Automatic review recovery failed");
    expect(JSON.stringify(error.mock.calls)).not.toContain(unsafeCode);
    expect(JSON.stringify(error.mock.calls)).not.toMatch(/private@example|555-0100/);
  });

  it("attempts rejection cleanup with its exact token without clearing a replacement lease", async () => {
    const harness = pendingAutomaticRecoveryHarness();
    const replacementExpiry = new Date(Date.now() + 60_000);
    const failure = Object.assign(new Error("known_rebuild_failure"), { code: "known_rebuild_failure" });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockImplementation(async () => {
      Object.assign(harness.request, {
        rebuildState: "rebuilding", rebuildToken: "replacement-token", rebuildLeaseExpiresAt: replacementExpiry,
      });
      throw failure;
    });

    await expect(new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
      .recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() })).rejects.toBe(failure);
    expect(harness.cleanupAttempts()).toBe(1);
    expect(harness.request).toMatchObject({
      rebuildState: "rebuilding", rebuildToken: "replacement-token", rebuildLeaseExpiresAt: replacementExpiry,
    });
  });

  it("renews an owned rebuild lease so a short-TTL long rebuild cannot start twice", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-12T12:00:00.000Z"));
    const harness = pendingAutomaticRecoveryHarness();
    let releaseRebuild!: () => void;
    const rebuildGate = new Promise<void>((resolve) => { releaseRebuild = resolve; });
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockImplementation(async () => {
      await rebuildGate;
      return { status: "ready_to_apply", manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] } };
    });
    const store = new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never);
    let first: Promise<unknown> | undefined;
    let second: Promise<unknown> | undefined;
    try {
      first = store.recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() });
      await vi.advanceTimersByTimeAsync(0);
      expect(rebuild).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(31 * 60_000);
      second = store.recoverOneAutomaticReview({ workerId: "worker-2", now: new Date() });
      await vi.advanceTimersByTimeAsync(0);

      expect(rebuild).toHaveBeenCalledOnce();
      expect(harness.renewals()).toBeGreaterThan(0);
    } finally {
      releaseRebuild();
      await vi.advanceTimersByTimeAsync(100);
      await Promise.allSettled([first, second].filter((value): value is Promise<unknown> => Boolean(value)));
      vi.useRealTimers();
    }
  });

  it("releases only its owned lease when rebuild output is missing or not ready", async () => {
    const invalidResults = [
      { status: "complete_with_issues", manifest: { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] } },
      { status: "ready_to_apply" },
    ];
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");
    for (const invalid of invalidResults) {
      const harness = pendingAutomaticRecoveryHarness();
      rebuild.mockResolvedValueOnce(invalid as never);
      await expect(new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
        .recoverOneAutomaticReview({ workerId: "worker-1", now: new Date() })).rejects.toMatchObject({
          code: "manifest_rebuild_incomplete", status: 409,
        });
      expect(harness.cleanupAttempts()).toBe(1);
      expect(harness.request).toMatchObject({ rebuildState: "pending", rebuildToken: null, rebuildLeaseExpiresAt: null });
    }
  });

  it("atomically upgrades a verified zero-decision legacy run to the canonical digest", async () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "organization:required:field:a", sourceRecordId: "required", sourceVersionId: "v-required",
          targetType: "organization", action: "fill_missing", payload: {}, dependencyOperationKeys: [],
          requiredForSourceOutcome: true, safeByDefault: true,
        },
        {
          operationKey: "organization:required:field:z", sourceRecordId: "required", sourceVersionId: "v-required",
          targetType: "organization", action: "fill_missing", payload: {}, dependencyOperationKeys: [],
          requiredForSourceOutcome: true, safeByDefault: true,
        },
      ],
      outcomes: [{
        sourceRecordId: "required", sourceVersionId: "v-required", state: "awaiting_review",
        issues: [{
          code: "relationship_unresolved", reason: "required_parent_missing", relationshipSlot: "required-parent",
          expectedParentTypes: ["organization"], canImportStandalone: false,
        }],
        candidates: [], match: null, mappingWarnings: [], unsupportedFieldPaths: [],
      }],
    });
    const legacyManifest = {
      ...manifest,
      outcomes: manifest.outcomes.map((outcome) => ({
        ...outcome,
        operationKeys: ["organization:required:field:z", "organization:required:field:a"],
      })),
    };
    const legacyDigest = digestLegacyManifestRows(legacyManifest.operations, legacyManifest.outcomes);
    let runUpdate: Record<string, unknown> | undefined;
    let insertedRequest: Record<string, unknown> | undefined;
    const transaction = {
      select: () => {
        let table: unknown;
        const rows = () => table === actReplacementRuns
          ? [{ summary: { manifestDigest: legacyDigest }, manifestDigestVersion: null, phase: "ready_to_apply" }]
          : [];
        const chain = {
          from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
          for: async () => rows(), then: (resolve: (rows: unknown[]) => unknown) => resolve(rows()),
        };
        return chain;
      },
      execute: async () => ({ rows: [{ sourceRecordId: "required", sourceVersionId: "v-required", streamType: "contact" }] }),
      insert: () => ({ values: async (values: Record<string, unknown>) => { insertedRequest = values; } }),
      update: (table: unknown) => ({
        set: (values: Record<string, unknown>) => ({
          where: () => ({ returning: async () => {
            if (table === actReplacementRuns) runUpdate = values;
            return [{ id: "run" }];
          } }),
        }),
      }),
    };
    const database = { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(manifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue(manifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeLegacyAutomaticReviewManifest")
      .mockResolvedValue({ ...legacyManifest, digest: legacyDigest });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "listSources").mockResolvedValue([{
      sourceRecordId: "required", sourceVersionId: "v-required", streamType: "contact", display: { FirstName: "Needs", LastName: "Parent" },
    }]);
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", {
        expectedManifestDigest: legacyDigest, owner: "owner", requestKey: "legacy-zero", policyVersion: "2026-08-12",
      })).resolves.toMatchObject({ decisions: [], manifestDigest: manifest.digest });
    expect(runUpdate).toMatchObject({ manifestDigestVersion: "canonical-json-v1" });
    expect(insertedRequest).toMatchObject({ manifestDigest: manifest.digest, decisionIds: [] });
    expect(legacyManifest.outcomes[0]?.operationKeys).not.toEqual(manifest.outcomes[0]?.operationKeys);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("defers a legacy stale-marker recovery to the automatic-review worker", async () => {
    const preDecision = manifestFromRows({
      operations: [],
      outcomes: [{
        sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", state: "unsupported",
        issues: [{ code: "unsupported_record", reason: "normalization_failed" }], candidates: [],
        match: null, mappingWarnings: [], unsupportedFieldPaths: [],
      }],
    });
    const legacyDigest = digestLegacyManifestRows(preDecision.operations, preDecision.outcomes);
    const input = {
      expectedManifestDigest: legacyDigest, owner: "owner", requestKey: "legacy-pending", policyVersion: "2026-08-12",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "v-unsupported",
      scope: "unsupported_record" as const, decision: "ignore_source" as const,
      requestKey: "legacy-pending:1", requestFingerprint: "individual-fingerprint",
      fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null,
      reviewedSourceValue: null, reviewedSourceValueFingerprint: null,
      reviewedLocalValue: null, reviewedLocalValueFingerprint: null,
      decidedBy: "owner", active: true, supersededAt: null, supersededBy: null, createdAt: new Date(),
    };
    const request = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [decision],
      }),
      requestedBy: "owner", decisionIds: [decision.id], manifestDigest: "__pending_review_rebuild__",
      reviewedOperationIds: [], automaticSummary: automaticReviewSummaryFromDecisions([decision as never]),
      rebuildState: "pending", rebuildToken: null, rebuildLeaseExpiresAt: null,
    };
    const run = { summary: { manifestDigest: legacyDigest }, manifestDigestVersion: null, phase: "ready_to_apply" };
    let sourceLocks = 0;
    const rowsFor = (table: unknown) => table === actReplacementRuns ? [run]
      : table === actReplacementReviewDecisions ? [decision] : [request];
    const transaction = {
      select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
          for: async () => rowsFor(table), then: (resolve: (rows: unknown[]) => unknown) => resolve(rowsFor(table)),
        };
        return chain;
      },
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("select expected_manifest_digest")) return { rows: [{
          expectedManifestDigest: null, automaticSummary: request.automaticSummary,
          rebuildState: request.rebuildState, rebuildToken: request.rebuildToken,
          rebuildLeaseExpiresAt: request.rebuildLeaseExpiresAt,
        }] };
        if (rendered.includes("act_source_records") && rendered.includes("for update")) {
          sourceLocks += 1;
          return { rows: [{ sourceRecordId: decision.sourceRecordId, sourceVersionId: decision.sourceVersionId, streamType: "contact" }] };
        }
        Object.assign(request, { rebuildState: "rebuilding", rebuildToken: "lease", rebuildLeaseExpiresAt: new Date(Date.now() + 60_000) });
        return { rows: [{ id: "request" }] };
      },
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      execute: async () => ({ rows: [{ id: "request" }] }),
    } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(preDecision);
    const recompute = vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue(preDecision);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeLegacyAutomaticReviewManifest")
      .mockResolvedValue({ ...preDecision, digest: legacyDigest });
    let preRebuildRun: unknown;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockImplementation(async () => {
      preRebuildRun = { ...run, summary: { ...run.summary } };
      return { status: "ready_to_apply", manifest: { digest: "f".repeat(64), diagnostics: [], operations: [], outcomes: [] } };
    });

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", input)).resolves.toEqual({ status: "processing" });
    expect(sourceLocks).toBe(0);
    expect(recompute).not.toHaveBeenCalled();
    expect(preRebuildRun).toBeUndefined();
  });

  it("leaves post-rebuild crash recovery to the automatic-review worker", async () => {
    const harness = postRebuildRecoveryHarness();
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(harness.manifest);
    const recompute = vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue(harness.manifest);
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");

    await expect(new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", harness.input)).resolves.toEqual({ status: "processing" });
    expect(harness.sourceLocks()).toBe(0);
    expect(recompute).not.toHaveBeenCalled();
    expect(harness.finalizations()).toBe(0);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("does not restart a pending rebuild from the HTTP replay path", async () => {
    const harness = pendingAutomaticRecoveryHarness();
    const publishedManifest = {
      digest: "digest-after", diagnostics: [], operations: [], outcomes: [],
    };
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(publishedManifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue(publishedManifest);
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockImplementationOnce(async () => {
        harness.publishRunDigest(publishedManifest.digest);
        throw new Error("connection_lost_after_atomic_manifest_publish");
      });
    const store = new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.resolveAutomaticReviewAndRebuild("run", harness.input))
      .resolves.toEqual({ status: "processing" });
    expect(rebuild).not.toHaveBeenCalled();
    expect(harness.cleanupAttempts()).toBe(0);
  });

  it("does not inspect post-rebuild durable state from the HTTP replay path", async () => {
    const harness = postRebuildRecoveryHarness();
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(harness.manifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue({
      ...harness.manifest, digest: "f".repeat(64),
    });
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");

    await expect(new DrizzleActReviewCommandStore(harness.database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", harness.input)).resolves.toEqual({ status: "processing" });
    expect(harness.sourceLocks()).toBe(0);
    expect(harness.finalizations()).toBe(0);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("returns processing for an unfinished durable request without rebuilding in HTTP", async () => {
    const input = {
      expectedManifestDigest: "digest-before", owner: "owner", requestKey: "automatic-crash", policyVersion: "2026-08-12",
    };
    const decision = {
      id: "decision-1", sourceRecordId: "unsupported", sourceVersionId: "v-unsupported",
      scope: "unsupported_record" as const, decision: "ignore_source" as const,
      requestKey: "automatic-crash:1", requestFingerprint: "individual-fingerprint",
      fieldName: null, relationshipSlot: null, targetEntityType: null, targetEntityId: null,
      reviewedSourceValue: null, reviewedSourceValueFingerprint: null,
      reviewedLocalValue: null, reviewedLocalValueFingerprint: null,
      decidedBy: "owner", active: true, supersededAt: null, supersededBy: null, createdAt: new Date(),
    };
    const request: Record<string, unknown> = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [decision],
      }),
      requestedBy: "owner", decisionIds: [decision.id], manifestDigest: "__pending_review_rebuild__",
      expectedManifestDigest: input.expectedManifestDigest, reviewedOperationIds: [], rebuildState: "pending",
      rebuildToken: null, rebuildLeaseExpiresAt: null,
      automaticSummary: automaticReviewSummaryFromDecisions([decision as never]),
    };
    let runDigest = "digest-before";
    const rowsFor = (table: unknown) => table === actReplacementRuns
      ? [{ summary: { manifestDigest: runDigest } }]
      : table === actReplacementReviewDecisions ? [decision] : [request];
    const transaction = {
      select: () => {
        let table: unknown;
        const chain = {
          from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
          for: async () => rowsFor(table), then: (resolve: (rows: unknown[]) => unknown) => resolve(rowsFor(table)),
        };
        return chain;
      },
      update: () => ({ set: (values: Record<string, unknown>) => ({ where: async () => { Object.assign(request, values); } }) }),
      execute: async (query: unknown) => {
        const rendered = new PgDialect().sqlToQuery(query as never).sql;
        if (rendered.includes("select expected_manifest_digest")) return { rows: [{
          expectedManifestDigest: request.expectedManifestDigest, automaticSummary: request.automaticSummary,
          rebuildState: request.rebuildState, rebuildToken: request.rebuildToken,
          rebuildLeaseExpiresAt: request.rebuildLeaseExpiresAt,
        }] };
        if (rendered.includes("set manifest_digest")) {
          Object.assign(request, { manifestDigest: "digest-after", reviewedOperationIds: [], rebuildState: "complete" });
        } else {
          Object.assign(request, { rebuildState: "rebuilding", rebuildToken: "lease", rebuildLeaseExpiresAt: new Date(Date.now() + 60_000) });
        }
        return { rows: [] };
      },
    };
    let failFinalization = true;
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      update: () => ({ set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (failFinalization) { failFinalization = false; throw new Error("connection_lost_after_rebuild"); }
          Object.assign(request, values);
        },
      }) }),
      execute: async () => {
        if (failFinalization) { failFinalization = false; throw new Error("connection_lost_after_rebuild"); }
        Object.assign(request, { manifestDigest: "digest-after", reviewedOperationIds: [], rebuildState: "complete" });
        return { rows: [{ id: "request" }] };
      },
    } as never;
    const rebuiltManifest = { digest: "digest-after", diagnostics: [], operations: [], outcomes: [] };
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(rebuiltManifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue(rebuiltManifest);
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockImplementation(async () => {
      runDigest = "digest-after";
      return { status: "ready_to_apply", manifest: rebuiltManifest };
    });
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.resolveAutomaticReviewAndRebuild("run", input)).resolves.toEqual({ status: "processing" });
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("replays the persisted automatic manual-review count", async () => {
    const input = {
      expectedManifestDigest: "digest-before", owner: "owner", requestKey: "automatic-manual", policyVersion: "2026-08-12",
    };
    const request = {
      requestFingerprint: automaticReviewRequestFingerprint({
        runId: "run", expectedManifestDigest: input.expectedManifestDigest, actor: input.owner,
        policyVersion: input.policyVersion, decisions: [],
      }),
      requestedBy: "owner", decisionIds: [], manifestDigest: "digest-before", reviewedOperationIds: [],
      automaticSummary: { ...automaticReviewSummaryFromDecisions([]), manualReview: 1 },
    };
    const transaction = {
      select: () => {
        let table: unknown;
        const rows = () => table === actReplacementRuns ? [{ summary: { manifestDigest: "digest-before" } }] : [request];
        const chain = {
          from: (value: unknown) => { table = value; return chain; }, where: () => chain, limit: () => chain,
          for: async () => rows(), then: (resolve: (value: unknown[]) => unknown) => resolve(table === actReplacementReviewDecisions ? [] : rows()),
        };
        return chain;
      },
      execute: async () => ({ rows: [{
        expectedManifestDigest: input.expectedManifestDigest,
        automaticSummary: request.automaticSummary,
        rebuildState: "complete", rebuildToken: null, rebuildLeaseExpiresAt: null,
      }] }),
    };
    const database = { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", input)).resolves.toMatchObject({
        decisions: [], summary: { manualReview: 1, decisionsCreatedOrReplayed: 0 },
      });
  });

  it("reloads current owner-visible name matches so a new duplicate target remains manual", async () => {
    const target = (id: string) => ({ id, entityType: "contact", label: "Natalie Andelin", detail: null, fields: {} });
    let visibleTargetReads = 0;
    const transaction = {
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => [{ summary: { manifestDigest: "digest-1" } }],
          then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
        };
        return chain;
      },
      execute: async (query: unknown) => {
        const renderedQuery = new PgDialect().sqlToQuery(query as never);
        const rendered = renderedQuery.sql;
        if (rendered.includes("act_source_records") && rendered.includes("for update")) {
          return { rows: [{ sourceRecordId: "natalie", sourceVersionId: "v-natalie", streamType: "contact" }] };
        }
        if (rendered.includes("owner_visible_targets")) {
          visibleTargetReads += 1;
          return { rows: [target("target-1"), target("target-2")] };
        }
        if (rendered.includes("contacts") && rendered.includes("for update")) {
          return { rows: [{ id: "target-1" }, { id: "target-2" }] };
        }
        return { rows: [] };
      },
      insert: () => ({ values: async () => {} }),
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    } as never;
    const manifest = {
      digest: "digest-1", diagnostics: [], operations: [],
      outcomes: [{
        sourceRecordId: "natalie", sourceVersionId: "v-natalie", state: "awaiting_review" as const,
        issues: [{ code: "ambiguous_match", reason: "insufficient_independent_context_clues" }],
        candidates: [{ candidateId: "target-1" }],
        match: { kind: "ambiguous", candidateIds: ["target-1"], reason: "insufficient_independent_context_clues" },
        mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
      }],
    };
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getComputedManifest").mockResolvedValue(manifest);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "listSources").mockResolvedValue([
      { sourceRecordId: "natalie", sourceVersionId: "v-natalie", streamType: "contact", display: { FirstName: "Natalie", LastName: "Andelin" } },
    ]);
    vi.spyOn(
      DrizzleActReviewCommandStore.prototype as unknown as { lockedConflictTarget: (entityType: string, entityId: string) => Promise<unknown> },
      "lockedConflictTarget",
    ).mockResolvedValue(target("target-1"));
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision").mockImplementation(async (input) => ({ ...input, id: "unsafe", active: true }));
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange").mockResolvedValue({
      status: "ready_to_apply", manifest: { ...manifest, digest: "digest-2" },
    });

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", {
        expectedManifestDigest: "digest-1", owner: "owner", requestKey: "duplicate-refresh", policyVersion: "2026-08-12",
      })).resolves.toMatchObject({ decisions: [], manifestDigest: "digest-1" });
    expect(visibleTargetReads).toBeGreaterThan(0);
    expect(save).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("renders deterministic owner-scoped selected-source row locking", () => {
    const rendered = new PgDialect().sqlToQuery(lockBulkSourceRowsQuery(
      { sourceDatabaseKey: "act-db" }, ["source-b", "source-a"],
    ));

    expect(rendered.sql).toContain("order by");
    expect(rendered.sql).toContain("for update");
    expect(rendered.params).toEqual(["act-db", "source-a", "source-b"]);
  });

  it("locks every observed source in stable order and reloads relationship evidence", () => {
    const rendered = new PgDialect().sqlToQuery(lockAutomaticReviewSourceRowsQuery(
      { sourceDatabaseKey: "act-db" }, "run-id",
    ));

    expect(rendered.sql).toContain("act_replacement_observations");
    expect(rendered.sql).toContain("relationship_evidence");
    expect(rendered.sql).toContain("order by");
    expect(rendered.sql).toContain("for update of");
    expect(rendered.params).toEqual(["act-db", "run-id", "act-db"]);
  });

  it("can lock generated-manifest sources without materializing relationship evidence", () => {
    const rendered = new PgDialect().sqlToQuery(lockAutomaticReviewSourceRowsQuery(
      { sourceDatabaseKey: "act-db" }, "run-id", false,
    ));

    expect(rendered.sql).not.toContain("relationship_evidence");
    expect(rendered.sql).toContain("for update of");
  });

  it("discovers automatic targets by exact normalized equality without a noisy 25-row window", () => {
    const rendered = new PgDialect().sqlToQuery(automaticTargetExactMatchQuery("contact", "  Natalie   Andelin ")!);

    expect(rendered.sql).toContain(" = ");
    expect(rendered.sql).not.toContain(" like ");
    expect(rendered.sql).toMatch(/limit \$\d+/);
    expect(rendered.params.at(-1)).toBe(2);
  });

  it("validates every locked latest source version before the first decision insert", async () => {
    let selects = 0;
    const events: string[] = [];
    const transaction = {
      select: () => {
        selects += 1;
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => [{ summary: { manifestDigest: "digest-1" } }],
          then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
        };
        return chain;
      },
      execute: async () => {
        events.push("sources:lock");
        return { rows: [
          { sourceRecordId: "a", sourceVersionId: "v-a", streamType: "company" },
          { sourceRecordId: "b", sourceVersionId: "new-v-b", streamType: "company" },
        ] };
      },
    };
    const database = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision");
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest").mockResolvedValue(unsupportedBulkManifest([
      { sourceRecordId: "a", sourceVersionId: "v-a" },
      { sourceRecordId: "b", sourceVersionId: "v-b" },
    ]));
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.saveDecisionsAndRebuild("run", {
      expectedManifestDigest: "digest-1", owner: "owner", requestKey: "bulk", requestFingerprint: "fingerprint",
      ...unsupportedBulkStoreInput([
        { sourceRecordId: "b", sourceVersionId: "v-b" },
        { sourceRecordId: "a", sourceVersionId: "v-a" },
      ]),
    })).rejects.toMatchObject({ code: "stale_source_version", status: 409 });
    expect(events).toEqual(["sources:lock"]);
    expect(save).not.toHaveBeenCalled();
  });

  it("keeps bulk decisions durable for retry when the organizer fails after commit", async () => {
    let committed = false;
    let selects = 0;
    const transaction = {
      select: () => {
        selects += 1;
        const chain = { from: () => chain, where: () => chain, limit: () => chain, for: async () => [{ summary: { manifestDigest: "digest-1" } }], then: (resolve: (rows: unknown[]) => unknown) => resolve([]) };
        return chain;
      },
      execute: async () => ({ rows: [{ sourceRecordId: "a", sourceVersionId: "v-a", streamType: "company" }] }),
      insert: () => ({ values: async () => {} }),
    };
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
        const result = await callback(transaction);
        committed = true;
        return result;
      },
    } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getSource")
      .mockImplementation(async (sourceRecordId) => ({ sourceRecordId, sourceVersionId: `v-${sourceRecordId}`, streamType: "company", actRecordId: null, display: {} }));
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision")
      .mockImplementation(async (input) => ({ ...input, id: "decision", active: true }));
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockRejectedValue(Object.assign(new Error("rebuild failed"), { code: "manifest_rebuild_failed" }));
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest")
      .mockResolvedValue(unsupportedBulkManifest([{ sourceRecordId: "a", sourceVersionId: "v-a" }]));
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.saveDecisionsAndRebuild("run", {
      expectedManifestDigest: "digest-1",
      owner: "owner", requestKey: "bulk", requestFingerprint: "fingerprint",
      ...unsupportedBulkStoreInput([{ sourceRecordId: "a", sourceVersionId: "v-a" }]),
    })).rejects.toMatchObject({ code: "manifest_rebuild_failed" });
    expect(committed).toBe(true);
  });

  it("rejects a stale locked digest before inserting any bulk decision", async () => {
    const transaction = {
      select: () => {
        const chain = { from: () => chain, where: () => chain, limit: () => chain, for: async () => [{ summary: { manifestDigest: "current" } }], then: (resolve: (rows: unknown[]) => unknown) => resolve([]) };
        return chain;
      },
    };
    const database = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision");
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.saveDecisionsAndRebuild("run", {
      expectedManifestDigest: "stale",
      owner: "owner", requestKey: "bulk", requestFingerprint: "fingerprint",
      ...unsupportedBulkStoreInput([{ sourceRecordId: "a", sourceVersionId: "v-a" }]),
    })).rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
    expect(save).not.toHaveBeenCalled();
  });

  it("rejects a durable bulk request fingerprint collision before saving a decision", async () => {
    let selects = 0;
    const transaction = {
      select: () => {
        selects += 1;
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => [{ summary: { manifestDigest: "digest-1" } }],
          then: (resolve: (rows: unknown[]) => unknown) => resolve(
            selects === 2 ? [{ requestFingerprint: "original-fingerprint", requestedBy: "owner", decisionIds: [], manifestDigest: "digest-2", reviewedOperationIds: [] }] : [],
          ),
        };
        return chain;
      },
    };
    const database = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getSource")
      .mockResolvedValue({ sourceRecordId: "a", sourceVersionId: "v-a", streamType: "company", actRecordId: null, display: {} });
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision")
      .mockImplementation(async (input) => ({ ...input, id: "decision-a", active: true }));
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange")
      .mockResolvedValue({ status: "ready_to_apply", manifest: { digest: "digest-2", diagnostics: [], outcomes: [], operations: [] } });
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest")
      .mockResolvedValue({ digest: "digest-2", diagnostics: [], outcomes: [], operations: [] });
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.saveDecisionsAndRebuild("run", {
      expectedManifestDigest: "digest-1",
      owner: "owner",
      requestKey: "bulk",
      requestFingerprint: "changed-fingerprint",
      ...unsupportedBulkStoreInput([{ sourceRecordId: "a", sourceVersionId: "v-a" }]),
    } as never)).rejects.toMatchObject({ code: "request_replay_mismatch", status: 409 });
    expect(save).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("atomically rejects the wrong run owner in the locked predicate without writes", async () => {
    let runWhere: unknown;
    const transaction = {
      select: () => {
        const chain = {
          from: () => chain,
          where: (condition: unknown) => { runWhere = condition; return chain; },
          limit: () => chain,
          for: async () => [],
        };
        return chain;
      },
    };
    const database = { transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision");
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");
    const store = new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never);

    await expect(store.saveDecisionsAndRebuild("run", {
      expectedManifestDigest: "digest-1", owner: "intruder", requestKey: "bulk", requestFingerprint: "fingerprint",
      ...unsupportedBulkStoreInput([{ sourceRecordId: "a", sourceVersionId: "v-a" }]),
    } as never)).rejects.toMatchObject({ code: "run_not_found", status: 404 });

    const rendered = new PgDialect().sqlToQuery(sql`${runWhere as never}`);
    expect(rendered.params).toEqual(["run", "act-db", "intruder"]);
    expect(save).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
  });
  it("projects only explicitly allowed contact display fields", () => {
    expect(
      projectActReviewDisplay("contact", {
        FirstName: "Taako",
        LastName: "Taaco",
        Email: "taako@example.com",
        EmailAddress: "act-taako@example.com",
        BusinessPhone: "555-ACT",
        apiKey: "credential-one",
        credential: "credential-two",
        privateKey: "credential-three",
        customScalar: "private custom value",
      }),
    ).toEqual({
      FirstName: "Taako",
      LastName: "Taaco",
      Email: "taako@example.com",
      EmailAddress: "act-taako@example.com",
      BusinessPhone: "555-ACT",
    });
  });

  it("rejects mutated durable manifest rows when the stored run summary is stale", async () => {
    const original = manifestFromRows({
      operations: [],
      outcomes: [{
        sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", state: "unsupported",
        issues: [{ code: "unsupported_record", reason: "normalization_failed" }], candidates: [],
        match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
      }],
    });
    const mutated = {
      ...manifestFromRows({
        operations: [],
        outcomes: [{
          sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", state: "unsupported",
          issues: [{ code: "unsupported_record", reason: "mutated_after_summary" }], candidates: [],
          match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
        }],
      }),
      digest: original.digest,
    };
    let manifestRead = 0;
    const transaction = {
      select: () => {
        const chain = {
          from: () => chain,
          where: () => chain,
          limit: () => chain,
          for: async () => [{ summary: { manifestDigest: original.digest } }],
          then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
        };
        return chain;
      },
      execute: async () => ({ rows: [{ sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", streamType: "custom" }] }),
      insert: () => ({ values: async () => {} }),
    };
    const database = {
      transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction),
      update: () => ({ set: () => ({ where: async () => {} }) }),
    } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest")
      .mockImplementation(async () => manifestRead++ === 0 ? original : mutated);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "listSources").mockResolvedValue([{
      sourceRecordId: "unsupported", sourceVersionId: "v-unsupported", streamType: "custom", display: { Name: "Legacy" },
    }]);
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision");
    const rebuild = vi.spyOn(DrizzleActReviewCommandStore.prototype, "rebuildAfterReviewChange");

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", {
        expectedManifestDigest: original.digest, owner: "owner", requestKey: "stale-summary", policyVersion: "2026-08-12",
      })).rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
    expect(save).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it("fails closed when locked relationship evidence recomputes a different manifest", async () => {
    const durable = manifestFromRows({
      operations: [],
      outcomes: [{
        sourceRecordId: "contact", sourceVersionId: "v-contact", state: "awaiting_review",
        issues: [{ code: "relationship_unresolved", reason: "missing_parent" }], candidates: [],
        match: null, mappingWarnings: [], unsupportedFieldPaths: [], operationKeys: [],
      }],
    });
    const transaction = {
      select: () => {
        const chain = {
          from: () => chain, where: () => chain, limit: () => chain,
          for: async () => [{ summary: { manifestDigest: durable.digest } }],
          then: (resolve: (rows: unknown[]) => unknown) => resolve([]),
        };
        return chain;
      },
      execute: async () => ({ rows: [{
        sourceRecordId: "contact", sourceVersionId: "v-contact", streamType: "contact",
        relationshipEvidence: { targetActRecordId: "mutated-parent" },
      }] }),
    };
    const database = { transaction: (callback: (tx: unknown) => Promise<unknown>) => callback(transaction) } as never;
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "getManifest").mockResolvedValue(durable);
    vi.spyOn(DrizzleActReviewCommandStore.prototype, "recomputeAutomaticReviewManifest").mockResolvedValue({
      ...durable,
      digest: "f".repeat(64),
    });
    const save = vi.spyOn(DrizzleActReviewCommandStore.prototype, "saveDecision");

    await expect(new DrizzleActReviewCommandStore(database, { sourceDatabaseKey: "act-db" }, {} as never)
      .resolveAutomaticReviewAndRebuild("run", {
        expectedManifestDigest: durable.digest, owner: "owner", requestKey: "relationship-mutation", policyVersion: "2026-08-12",
      })).rejects.toMatchObject({ code: "manifest_digest_mismatch", status: 409 });
    expect(save).not.toHaveBeenCalled();
  });

  it("replays stable rejected operation IDs and count from the durable manifest", () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "safe:create",
          sourceRecordId: "safe",
          sourceVersionId: "v-safe",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
        {
          operationKey: "conflict:create",
          sourceRecordId: "conflict",
          sourceVersionId: "v-conflict",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "safe",
          sourceVersionId: "v-safe",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
        {
          sourceRecordId: "conflict",
          sourceVersionId: "v-conflict",
          state: "awaiting_review",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
      ],
    });
    const row = {
      selectedOperationIds: ["safe:create"],
      dependencyClosedOperationIds: ["safe:create"],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 1,
      manifestDigest: manifest.digest,
      approvalMode: "automatic_safe",
      approvalModeVersion: 1,
    };

    const first = approvalClosureFromDurableRow(manifest, row);
    const replay = approvalClosureFromDurableRow(manifest, row);

    expect(first).toMatchObject({
      rejectedOperationIds: ["conflict:create"],
      rejectedCount: 1,
      approvalMode: "automatic_safe",
      approvalModeVersion: 1,
    });
    expect(replay).toEqual(first);
  });

  it("preserves null provenance on legacy durable approval rows", () => {
    const manifest = manifestFromRows({
      operations: [{
        operationKey: "safe:create",
        sourceRecordId: "safe",
        sourceVersionId: "v-safe",
        targetType: "organization",
        action: "create",
        payload: {},
        dependencyOperationKeys: [],
        requiredForSourceOutcome: true,
        safeByDefault: true,
      }],
      outcomes: [],
    });

    expect(approvalClosureFromDurableRow(manifest, {
      selectedOperationIds: ["safe:create"],
      dependencyClosedOperationIds: ["safe:create"],
      selectedCount: 1,
      dependencyCount: 0,
      rejectedCount: 0,
      manifestDigest: manifest.digest,
      approvalMode: null,
      approvalModeVersion: null,
    })).toMatchObject({ approvalMode: null, approvalModeVersion: null });
  });

  it("reconstructs the canonical manifest digest from persisted rows", () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "organization:a",
          sourceRecordId: "a",
          sourceVersionId: "v1",
          targetType: "organization",
          action: "create",
          payload: { normalized: { kind: "organization", name: "A" } },
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "a",
          sourceVersionId: "v1",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: ["organization:a"],
        },
      ],
    });
    expect(manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.operations[0]?.payload).toEqual({
      normalized: { kind: "organization", name: "A" },
    });
    expect(manifest.outcomes[0]?.state).toBe("ready");
  });

  it("sorts persisted rows before hashing so SQL result order cannot change approvals", () => {
    const rows = {
      operations: [
        {
          operationKey: "z",
          sourceRecordId: "z",
          sourceVersionId: "vz",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
        {
          operationKey: "a",
          sourceRecordId: "a",
          sourceVersionId: "va",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "z",
          sourceVersionId: "vz",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: ["z"],
        },
        {
          sourceRecordId: "a",
          sourceVersionId: "va",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
          operationKeys: ["a"],
        },
      ],
    };
    const reversed = manifestFromRows({
      operations: [...rows.operations].reverse(),
      outcomes: [...rows.outcomes].reverse(),
    });
    expect(manifestFromRows(rows).digest).toBe(reversed.digest);
  });

  it("keeps the organizer digest stable when execution updates outcome state", () => {
    const rows = {
      operations: [
        {
          operationKey: "organization:a",
          sourceRecordId: "a",
          sourceVersionId: "v1",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "a",
          sourceVersionId: "v1",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
      ],
    };
    const organized = manifestFromRows(rows);
    const executed = manifestFromRows(
      {
        ...rows,
        outcomes: [{ ...rows.outcomes[0]!, state: "applied" }],
      },
      organized.digest,
    );

    expect(executed.digest).toBe(organized.digest);
    expect(executed.outcomes[0]?.state).toBe("applied");
  });
  it("derives outcome operation keys from durable operation rows", () => {
    const manifest = manifestFromRows({
      operations: [
        {
          operationKey: "organization:a",
          sourceRecordId: "a",
          sourceVersionId: "v1",
          targetType: "organization",
          action: "create",
          payload: {},
          dependencyOperationKeys: [],
          requiredForSourceOutcome: true,
          safeByDefault: true,
        },
      ],
      outcomes: [
        {
          sourceRecordId: "a",
          sourceVersionId: "v1",
          state: "ready",
          issues: [],
          candidates: [],
          match: null,
          mappingWarnings: [],
          unsupportedFieldPaths: [],
        },
      ],
    });

    expect(manifest.outcomes[0]?.operationKeys).toEqual(["organization:a"]);
  });

  it("normalizes archived roots and applies exact relationships and active review evidence", () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1",
          sourceVersionId: "company-version-1",
          latestSourceVersionId: "company-version-1",
          streamType: "company",
          actRecordId: "company-act-1",
          rawSnapshot: { Name: "Adventure Zone" },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "contact-1",
          sourceVersionId: "contact-version-1",
          latestSourceVersionId: "contact-version-1",
          streamType: "contact",
          actRecordId: "contact-act-1",
          rawSnapshot: { FirstName: "Taako", LastName: "Taaco" },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "note-1",
          sourceVersionId: "note-version-1",
          latestSourceVersionId: "note-version-1",
          streamType: "note",
          actRecordId: "note-act-1",
          rawSnapshot: { Body: "Meet at the moon base." },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1",
          sourceVersionId: "relationship-version-1",
          latestSourceVersionId: "relationship-version-1",
          streamType: "company_contact",
          actRecordId: null,
          rawSnapshot: {},
          fetchedAt,
          relationshipEvidence: {
            source: "endpoint",
            parentKind: "contact",
            parentActRecordId: "contact-act-1",
            targetKind: "company",
            targetActRecordId: "company-act-1",
          },
        },
      ],
      assignments: [
        {
          sourceRecordId: "note-1",
          targetEntityType: "contact",
          targetEntityId: "contact-1",
          manualAuthority: true,
          active: true,
        },
      ],
      decisions: [
        {
          id: "decision-contact",
          sourceRecordId: "contact-1",
          sourceVersionId: "contact-version-1",
          scope: "duplicate_identity",
          decision: "link_existing",
          fieldName: null,
          targetEntityType: "contact",
          targetEntityId: "local-contact-1",
          decidedBy: "owner",
          createdAt: new Date("2026-08-08T00:00:00.000Z"),
          active: true,
        },
        {
          id: "decision-company",
          sourceRecordId: "company-1",
          sourceVersionId: "company-version-1",
          scope: "field_conflict",
          decision: "use_source",
          fieldName: "phone",
          targetEntityType: null,
          targetEntityId: null,
          reviewedSourceValue: "555-ACT",
          reviewedSourceValueFingerprint: fingerprintSourceContent({ value: "555-ACT" }),
          reviewedLocalValue: "555-LOCAL",
          reviewedLocalValueFingerprint: fingerprintSourceContent({ value: "555-LOCAL" }),
          decidedBy: "owner",
          createdAt: new Date("2026-08-08T00:00:00.000Z"),
          active: true,
        },
      ],
    });

    expect(sources).toHaveLength(3);
    expect(sources.find((source) => source.sourceRecordId === "company-1")).toMatchObject({
      normalized: { kind: "organization", name: "Adventure Zone" },
      reviewDecisions: [expect.objectContaining({
        reviewedSourceValue: "555-ACT",
        reviewedLocalValue: "555-LOCAL",
      })],
      provenance: ["decision:use_source"],
    });
    expect(sources.find((source) => source.sourceRecordId === "contact-1")).toMatchObject({
      normalized: { kind: "contact", firstName: "Taako", lastName: "Taaco" },
      match: {
        kind: "exact",
        localId: "local-contact-1",
        reason: "manual_review",
      },
      relationships: { organizationSourceIds: ["company-1"] },
      provenance: ["decision:link_existing", "relationship_record:company:contact"],
    });
    expect(sources.find((source) => source.sourceRecordId === "note-1")).toMatchObject({
      normalized: { kind: "timeline", body: "Meet at the moon base." },
      relationships: { contactSourceIds: ["contact-1"] },
      provenance: ["manual_assignment"],
    });
  });

  it("resolves a name-only company through an exact ACT contact relationship", () => {
    const fetchedAt = new Date("2026-08-10T12:00:00.000Z");
    const source = (sourceRecordId: string, streamType: string, actRecordId: string | null, rawSnapshot: Record<string, unknown>, relationshipEvidence: Record<string, unknown> = {}) => ({
      sourceRecordId,
      sourceVersionId: `${sourceRecordId}-version`,
      latestSourceVersionId: `${sourceRecordId}-version`,
      streamType,
      actRecordId,
      rawSnapshot,
      fetchedAt,
      relationshipEvidence,
    });
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        source("company-1", "company", "company-act-1", { Name: "10 Mile Pride (Breckenridge) CO" }),
        source("contact-1", "contact", "contact-act-1", { FirstName: "Breck", LastName: "Create", EmailAddress: "info@breckcreate.org", BusinessPhone: "(970) 547-3100" }),
        source("relationship-1", "company_contact", null, {}, {
          source: "endpoint",
          parentKind: "contact",
          parentActRecordId: "contact-act-1",
          targetKind: "company",
          targetActRecordId: "company-act-1",
        }),
      ],
      localCandidates: {
        organizations: [
          { id: "unrelated-company", name: "10 Mile Pride (Breckenridge) CO" },
          { id: "local-company-1", name: "10 Mile Pride (Breckenridge) CO" },
        ],
        contacts: [{
          id: "local-contact-1",
          firstName: "Breck",
          lastName: "Create",
          email: "info@breckcreate.org",
          phone: "970-547-3100",
          organizationIds: ["local-company-1"],
        }],
      },
    });

    expect(sources.find((row) => row.sourceRecordId === "company-1")?.match).toMatchObject({
      kind: "exact",
      localId: "local-company-1",
      reason: "resolved_by_contact_relationship_context",
      evidence: expect.arrayContaining([
        expect.objectContaining({ family: "identity", targetEntityId: "local-company-1" }),
        expect.objectContaining({
          family: "archive_relationship",
          authority: "authoritative",
          targetEntityId: "local-company-1",
        }),
      ]),
    });
  });

  it("cascades company resolution into contact and narrative timeline context", () => {
    const fetchedAt = new Date("2026-08-10T12:00:00.000Z");
    const source = (sourceRecordId: string, streamType: string, actRecordId: string | null, rawSnapshot: Record<string, unknown>, relationshipEvidence: Record<string, unknown> = {}) => ({
      sourceRecordId,
      sourceVersionId: `${sourceRecordId}-version`,
      latestSourceVersionId: `${sourceRecordId}-version`,
      streamType,
      actRecordId,
      rawSnapshot,
      fetchedAt,
      relationshipEvidence,
    });
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        source("company-1", "company", "company-act-1", { Name: "Adventure Zone", Website: "https://adventure.example" }),
        source("contact-1", "contact", "contact-act-1", { FirstName: "Merle", LastName: "Highchurch" }),
        source("history-1", "history", "history-act-1", { Subject: "Adventure Zone follow-up", Details: "Merle Highchurch confirmed the event." }),
        source("relationship-1", "company_contact", null, {}, {
          source: "endpoint",
          parentKind: "contact",
          parentActRecordId: "contact-act-1",
          targetKind: "company",
          targetActRecordId: "company-act-1",
        }),
      ],
      localCandidates: {
        organizations: [{ id: "local-company-1", name: "Adventure Zone", website: "https://adventure.example", phone: null, industry: null, address1: null, address2: null, city: null, region: null, postalCode: null }],
        contacts: [{ id: "local-contact-1", firstName: "Merle", lastName: "Highchurch", email: null, phone: null, organizationIds: ["local-company-1"] }],
      },
    });

    expect(sources.find((row) => row.sourceRecordId === "company-1")?.match).toMatchObject({ kind: "exact", localId: "local-company-1" });
    expect(sources.find((row) => row.sourceRecordId === "contact-1")?.match).toMatchObject({
      kind: "exact",
      localId: "local-contact-1",
      evidence: expect.arrayContaining([
        expect.objectContaining({ family: "identity" }),
        expect.objectContaining({ family: "archive_relationship" }),
      ]),
    });
    expect(sources.find((row) => row.sourceRecordId === "history-1")?.relationships).toEqual({
      organizationSourceIds: ["company-1"],
      contactSourceIds: ["contact-1"],
      bookingSourceIds: [],
    });
  });

  it("keeps durable replay projection lookup growth near-linear", () => {
    const lookupCount = (size: number) => {
      let lookups = 0;
      const tracked = <T extends Record<string, unknown>>(value: T, key: keyof T) => {
        const stored = value[key];
        Object.defineProperty(value, key, {
          enumerable: true,
          get() {
            lookups += 1;
            return stored;
          },
        });
        return value;
      };
      const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
      const ids = Array.from({ length: size }, (_, index) => `company-${String(index).padStart(4, "0")}`);
      const rows = ids.map((sourceRecordId, index) => ({
        sourceRecordId,
        sourceVersionId: `version-${index}`,
        latestSourceVersionId: `version-${index}`,
        streamType: "company" as const,
        actRecordId: `act-${index}`,
        rawSnapshot: { Name: `Company ${index}` },
        fetchedAt,
        relationshipEvidence: {},
      }));
      const decisions = ids.map((sourceRecordId, index) => tracked({
        id: `decision-${index}`,
        sourceRecordId,
        sourceVersionId: `version-${index}`,
        scope: "duplicate_identity" as const,
        decision: "link_existing" as const,
        fieldName: null,
        targetEntityType: "organization",
        targetEntityId: `local-${index}`,
        decidedBy: "owner",
        createdAt: fetchedAt,
        active: true,
      }, "sourceRecordId"));
      const assignments = ids.map((sourceRecordId, index) => tracked({
        sourceRecordId,
        targetEntityType: "organization",
        targetEntityId: `local-${index}`,
        manualAuthority: true,
        active: true,
      }, "sourceRecordId"));
      const organizations = ids.map((_sourceRecordId, index) => tracked({
        id: `local-${index}`,
        name: `Company ${index}`,
      }, "id"));

      manifestSourcesFromArchiveRows({
        rows,
        decisions,
        assignments,
        localCandidates: { organizations, contacts: [], bookings: [], externalLinks: [] },
      });
      return lookups;
    };

    const small = lookupCount(100);
    const large = lookupCount(200);
    expect(large / small).toBeLessThan(3);
  });

  it("projects only the valid local parent type for a broken relationship slot", () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "contact-1",
          sourceVersionId: "contact-version-1",
          latestSourceVersionId: "contact-version-1",
          streamType: "contact",
          actRecordId: "contact-act-1",
          archiveCompleteness: "complete",
          rawSnapshot: { FirstName: "Taako", LastName: "Taaco" },
          fetchedAt,
          relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1",
          sourceVersionId: "relationship-version-1",
          latestSourceVersionId: "relationship-version-1",
          streamType: "company_contact",
          actRecordId: null,
          archiveCompleteness: "complete",
          rawSnapshot: {},
          fetchedAt,
          relationshipEvidence: {
            source: "endpoint",
            parentKind: "contact",
            parentActRecordId: "contact-act-1",
            targetKind: "company",
            targetActRecordId: "missing-company-act-id",
          },
        },
      ],
    });

    expect(sources).toHaveLength(1);
    expect(sources[0]?.reviewIssues).toEqual([{
      code: "relationship_unresolved",
      reason: "unresolved_exact_relationship",
      relationshipSlot: "relationship-1",
      expectedParentTypes: ["organization"],
      canImportStandalone: true,
    }]);
  });

  it("projects active decisions only for their archived source version", () => {
    const sources = manifestSourcesFromArchiveRows({
      rows: [{
        sourceRecordId: "company-1", sourceVersionId: "company-version-1", latestSourceVersionId: "company-version-1",
        streamType: "company", actRecordId: "company-act-1", rawSnapshot: { Name: "Adventure Zone" },
        fetchedAt: new Date("2026-08-08T00:00:00.000Z"), relationshipEvidence: {},
      }],
      decisions: [
        {
          id: "decision-current", sourceRecordId: "company-1", sourceVersionId: "company-version-1",
          scope: "field_conflict", decision: "use_source", fieldName: "phone", targetEntityType: null,
          targetEntityId: null, active: true, decidedBy: "owner", createdAt: new Date("2026-08-08T00:00:00.000Z"),
        },
        {
          id: "decision-stale", sourceRecordId: "company-1", sourceVersionId: "company-version-old",
          scope: "field_conflict", decision: "keep_local", fieldName: "phone", targetEntityType: null,
          targetEntityId: null, active: true, decidedBy: "owner", createdAt: new Date("2026-08-07T00:00:00.000Z"),
        },
      ],
    });

    expect(sources[0]?.reviewDecisions).toEqual([{
      decisionId: "decision-current", sourceVersionId: "company-version-1", scope: "field_conflict",
      decision: "use_source", fieldName: "phone", targetEntityType: null, targetEntityId: null,
      decidedBy: "owner", createdAt: "2026-08-08T00:00:00.000Z",
    }]);
  });

  it("fails closed before ready_to_apply when an observation is not the latest archived version", async () => {
    let persisted = false;
    let completed = false;
    const releasedCodes: string[] = [];
    const store: ProductionOrganizerStore = {
      async claim(runId) {
        return { runId, phase: "organizing", claimToken: "claim-stale" };
      },
      async loadSources() {
        return manifestSourcesFromArchiveRows({
          rows: [
            {
              sourceRecordId: "company-1",
              sourceVersionId: "company-version-old",
              latestSourceVersionId: "company-version-new",
              streamType: "company",
              actRecordId: "company-act-1",
              rawSnapshot: { Name: "Adventure Zone" },
              fetchedAt: new Date("2026-08-07T12:00:00.000Z"),
              relationshipEvidence: {},
            },
          ],
        });
      },
      async renew() { return true; },
      async persistManifest() {
        persisted = true;
      },
      async complete() {
        completed = true;
      },
      async release(_runId, _claimToken, code) {
        releasedCodes.push(code);
      },
    };

    await expect(new ProductionActOrganizer(store).organize("run-stale")).rejects.toMatchObject({
      code: "stale_archived_source_version",
      status: 409,
    });
    expect(persisted).toBe(false);
    expect(completed).toBe(false);
    expect(releasedCodes).toEqual(["stale_archived_source_version"]);
  });

  it("holds incomplete archives, local duplicates, and unresolved relationships for review", async () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1", sourceVersionId: "company-version-1", latestSourceVersionId: "company-version-1", streamType: "company", actRecordId: "company-act-1", archiveCompleteness: "complete", rawSnapshot: { Name: "Adventure Zone" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "contact-1", sourceVersionId: "contact-version-1", latestSourceVersionId: "contact-version-1", streamType: "contact", actRecordId: "contact-act-1", archiveCompleteness: "complete", rawSnapshot: { FirstName: "Taako", LastName: "Taaco", EmailAddress: "same@example.com" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1", sourceVersionId: "relationship-version-1", latestSourceVersionId: "relationship-version-1", streamType: "company_contact", actRecordId: null, archiveCompleteness: "partial", rawSnapshot: {}, fetchedAt, relationshipEvidence: { source: "endpoint", parentKind: "contact", parentActRecordId: "contact-act-1", targetKind: "company", targetActRecordId: "company-act-1" },
        },
      ],
      localCandidates: {
        contacts: [
          { id: "local-1", firstName: "T", lastName: "One", email: "same@example.com" },
          { id: "local-2", firstName: "T", lastName: "Two", email: "same@example.com" },
        ],
      },
    });
    const result = await new ProductionActOrganizer({
      async claim(runId) { return { runId, phase: "organizing", claimToken: "claim" }; },
      async loadSources() { return sources; },
      async renew() { return true; },
      async persistManifest() {},
      async complete() {},
      async release() {},
    }).organize("run-review-holds");

    expect(result.manifest.outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceRecordId: "company-1", state: "awaiting_review", issues: expect.arrayContaining([expect.objectContaining({ code: "archive_incomplete" })]) }),
      expect.objectContaining({ sourceRecordId: "contact-1", state: "awaiting_review", issues: expect.arrayContaining([expect.objectContaining({ code: "archive_incomplete" }), expect.objectContaining({ code: "ambiguous_match" })]) }),
    ]));
    expect(result.manifest.operations.some((operation) => ["company-1", "contact-1"].includes(operation.sourceRecordId))).toBe(false);
  });

  it("archives a contact whose name and organization agree but direct contact data conflicts", async () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1", sourceVersionId: "company-version-1", latestSourceVersionId: "company-version-1", streamType: "company", actRecordId: "company-act-1", archiveCompleteness: "complete", rawSnapshot: { Name: "Adventure Zone" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "contact-1", sourceVersionId: "contact-version-1", latestSourceVersionId: "contact-version-1", streamType: "contact", actRecordId: "contact-act-1", archiveCompleteness: "complete", rawSnapshot: { FirstName: "Jane", LastName: "Doe", EmailAddress: "source@example.com" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1", sourceVersionId: "relationship-version-1", latestSourceVersionId: "relationship-version-1", streamType: "company_contact", actRecordId: null, archiveCompleteness: "complete", rawSnapshot: {}, fetchedAt, relationshipEvidence: { source: "endpoint", parentKind: "contact", parentActRecordId: "contact-act-1", targetKind: "company", targetActRecordId: "company-act-1" },
        },
      ],
      assignments: [
        { sourceRecordId: "company-1", targetEntityType: "organization", targetEntityId: "local-org", manualAuthority: true, active: true },
      ],
      localCandidates: {
        contacts: [{
          id: "local-contact",
          firstName: "Jane",
          lastName: "Doe",
          email: "different@example.com",
          organizationIds: ["local-org"],
        }],
      },
    });
    const result = await new ProductionActOrganizer({
      async claim(runId) { return { runId, phase: "organizing", claimToken: "claim-contact-conflict" }; },
      async loadSources() { return sources; },
      async renew() { return true; },
      async persistManifest() {},
      async complete() {},
      async release() {},
    }).organize("run-contact-conflict");

    expect(result.manifest.outcomes).toContainEqual(expect.objectContaining({
      sourceRecordId: "contact-1",
      state: "awaiting_review",
      issues: expect.arrayContaining([
        expect.objectContaining({ code: "ambiguous_match", reason: "conflicting_contact_fields" }),
      ]),
    }));
    expect(result.manifest.operations.some((operation) => operation.sourceRecordId === "contact-1")).toBe(false);
  });

  it("archives matcher overflow with only bounded candidates and evidence", async () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [{
        sourceRecordId: "company-overflow", sourceVersionId: "company-overflow-version", latestSourceVersionId: "company-overflow-version", streamType: "company", actRecordId: "company-overflow-act", archiveCompleteness: "complete", rawSnapshot: { Name: "Acme Adventures", Phone: "555-111-2222", Website: "https://acme.example.com", Address1: "1 Main St", City: "Denver", State: "CO", ZipCode: "80202" }, fetchedAt, relationshipEvidence: {},
      }],
      localCandidates: {
        organizations: Array.from({ length: 64 }, (_, index) => ({
          id: `organization-${String(index).padStart(3, "0")}`,
          name: "Acme Adventures",
          phone: "555-111-2222",
          website: "https://acme.example.com",
          address1: "1 Main St",
          city: "Denver",
          region: "CO",
          postalCode: "80202",
        })),
      },
    });
    const result = await new ProductionActOrganizer({
      async claim(runId) { return { runId, phase: "organizing", claimToken: "claim-overflow" }; },
      async loadSources() { return sources; },
      async renew() { return true; },
      async persistManifest() {},
      async complete() {},
      async release() {},
    }).organize("run-overflow");
    const outcome = result.manifest.outcomes.find((candidate) => candidate.sourceRecordId === "company-overflow");
    const match = outcome?.match as {
      candidateIds?: unknown;
      evidence?: unknown;
    } | null | undefined;

    expect(outcome).toMatchObject({
      state: "awaiting_review",
      match: {
        kind: "ambiguous",
        reason: "candidate_limit_exceeded",
        overflow: true,
      },
    });
    expect(Array.isArray(match?.candidateIds) ? match.candidateIds.length : Infinity).toBeLessThanOrEqual(20);
    expect(Array.isArray(match?.evidence) ? match.evidence.length : Infinity).toBeLessThanOrEqual(20);
    expect(result.manifest.operations.some((operation) => operation.sourceRecordId === "company-overflow")).toBe(false);
  });

  it("keeps undated sales imports in review for exact-organization booking candidates", async () => {
    const fetchedAt = new Date("2026-08-07T12:00:00.000Z");
    const sources = manifestSourcesFromArchiveRows({
      rows: [
        {
          sourceRecordId: "company-1", sourceVersionId: "company-v1", latestSourceVersionId: "company-v1", streamType: "company", actRecordId: "ACT-COMPANY", archiveCompleteness: "complete", rawSnapshot: { Name: "Adventure Zone" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "opportunity-1", sourceVersionId: "opportunity-v1", latestSourceVersionId: "opportunity-v1", streamType: "opportunity", actRecordId: "ACT-OPPORTUNITY", archiveCompleteness: "complete", rawSnapshot: { Name: "Summer Trip", City: "Denver", State: "CO", EstimatedCloseDate: "2026-08-12" }, fetchedAt, relationshipEvidence: {},
        },
        {
          sourceRecordId: "relationship-1", sourceVersionId: "relationship-v1", latestSourceVersionId: "relationship-v1", streamType: "company_opportunity", actRecordId: null, archiveCompleteness: "complete", rawSnapshot: {}, fetchedAt, relationshipEvidence: { source: "endpoint", parentKind: "company", parentActRecordId: "ACT-COMPANY", targetKind: "opportunity", targetActRecordId: "ACT-OPPORTUNITY" },
        },
      ],
      assignments: [
        { sourceRecordId: "company-1", targetEntityType: "organization", targetEntityId: "local-org", manualAuthority: true, active: true },
      ],
      localCandidates: {
        bookings: [
          { id: "booking-a", name: "Summer Trip", organizationId: "local-org", startsAt: "2026-08-12" },
          { id: "booking-b", name: "Summer Trip", organizationId: "local-org", startsAt: "2026-08-12" },
        ],
      },
    });

    const booking = sources.find((source) => source.sourceRecordId === "opportunity-1");
    expect(booking).toMatchObject({
      relationships: { organizationSourceIds: ["company-1"] },
      match: {
        kind: "ambiguous",
        candidateIds: ["booking-a", "booking-b"],
        reason: "booking_event_date_unverified",
      },
    });
    const manifest = await new ProductionActOrganizer({
      async claim(runId) { return { runId, phase: "organizing", claimToken: "claim" }; },
      async loadSources() { return sources; },
      async renew() { return true; },
      async persistManifest() {},
      async complete() {},
      async release() {},
    }).organize("run-booking-review");
    expect(manifest.manifest.outcomes).toContainEqual(expect.objectContaining({ sourceRecordId: "opportunity-1", state: "awaiting_review" }));
    expect(manifest.manifest.operations.some((operation) => operation.sourceRecordId === "opportunity-1")).toBe(false);
  });
});
