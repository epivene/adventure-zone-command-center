import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { approvalClosureFromDurableRow, DrizzleActReviewCommandStore, DrizzleActReviewReader, DrizzleProductionOrganizerStore, lockBulkSourceRowsQuery, manifestFromRows, manifestSourcesFromArchiveRows, manifestWriteBatches, operationSemanticsMatch, projectActReviewDisplay, staleNonterminalOperationPredicate } from "./review-sql-adapter";
import { ProductionActOrganizer, type ProductionOrganizerStore } from "./production-organizer";
import { individualDecisionRequestFingerprint } from "./review-command-service";
import { fingerprintSourceContent } from "./source-fingerprint";
import { actReplacementReviewDecisions, actReplacementRuns, actSourceRecords } from "@workspace/db/schema";

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
  it("aggregates globally, pages in SQL, and loads payloads only for page sources", async () => {
    const queries: unknown[] = [];
    const responses = [
      [{
        manifestDigest: "digest-sql",
        decisionRequired: 5,
        issueCounts: {
          ambiguous_match: 1,
          field_conflict: 1,
          relationship_unresolved: 1,
          unassigned: 1,
          unsupported_record: 1,
        },
        diagnosticCounts: { unsupported_field: 50 },
      }],
      [{ total: 1 }],
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

    const page = await new DrizzleActReviewReader(database, { sourceDatabaseKey: "act-db" })
      .readReviewPage({ runId: "run", issue: "field_conflict", page: 2, pageSize: 25 });

    expect(page).toMatchObject({
      total: 1,
      manifestDigest: "digest-sql",
      summary: {
        decisionRequired: 5,
        diagnosticCounts: { unsupported_field: 50 },
      },
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
    expect(rendered[0]?.params).toEqual(expect.arrayContaining(["awaiting_review", "unassigned", "unsupported"]));
    expect(rendered[1]?.sql).toContain("count(*)");
    expect(rendered[2]?.sql).toContain("limit");
    expect(rendered[2]?.sql).toContain("offset");
    expect(rendered[2]?.params).toEqual(expect.arrayContaining([25, 25]));
    expect(rendered[3]?.params).toContain("source-on-page");
    expect(rendered[3]?.params).not.toContain("source-off-page");
  });

  it("searches only stream-allowlisted display fields, never the full raw snapshot", async () => {
    const queries: unknown[] = [];
    const responses = [
      [{ manifestDigest: "digest-search", decisionRequired: 0, issueCounts: {}, diagnosticCounts: {} }],
      [{ total: 0 }],
      [],
    ];
    const database = {
      execute: async (query: unknown) => {
        queries.push(query);
        return { rows: responses.shift() ?? [] };
      },
    } as never;

    await new DrizzleActReviewReader(database, { sourceDatabaseKey: "act-db" })
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
    const reader = new DrizzleActReviewReader(database, { sourceDatabaseKey: "act-db" });

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

  it("reclaims a ready run only when no apply work has started", async () => {
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
    expect(rendered.sql.match(/not exists/g)).toHaveLength(2);
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
    const database = {
      transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
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

  it("renders deterministic owner-scoped selected-source row locking", () => {
    const rendered = new PgDialect().sqlToQuery(lockBulkSourceRowsQuery(
      { sourceDatabaseKey: "act-db" }, ["source-b", "source-a"],
    ));

    expect(rendered.sql).toContain("order by");
    expect(rendered.sql).toContain("for update");
    expect(rendered.params).toEqual(["act-db", "source-a", "source-b"]);
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
        apiKey: "credential-one",
        credential: "credential-two",
        privateKey: "credential-three",
        customScalar: "private custom value",
      }),
    ).toEqual({
      FirstName: "Taako",
      LastName: "Taaco",
      Email: "taako@example.com",
    });
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
    };

    const first = approvalClosureFromDurableRow(manifest, row);
    const replay = approvalClosureFromDurableRow(manifest, row);

    expect(first).toMatchObject({
      rejectedOperationIds: ["conflict:create"],
      rejectedCount: 1,
    });
    expect(replay).toEqual(first);
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

  it("matches booking candidates only through an exact resolved local organization", async () => {
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
        reason: "multiple_compatible_booking_candidates",
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
