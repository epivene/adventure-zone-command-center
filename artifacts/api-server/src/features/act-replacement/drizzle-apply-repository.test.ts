import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { loadActReviewMigrations } from "@workspace/db/migrations";
import { DrizzleContactRepository } from "@/features/contacts/contact-repository";
import { DrizzleApplyRepository, createDrizzleApplyRepository } from "./drizzle-apply-repository";
import { localValueFingerprint } from "./local-edit-policy";
import type { ReviewedOverwriteInput } from "./apply-repository";

const attempt = { batchId: "batch-1", attemptToken: "11111111-1111-1111-1111-111111111111" };
const storedOperation = {
  id: "operation-1", operationKey: "organization:source-1", sourceRecordId: "source-1", sourceVersionId: "version-1",
  targetType: "organization" as const, action: "create" as const, payload: {}, dependencyOperationKeys: [],
  requiredForSourceOutcome: true, safeByDefault: true, status: "leased" as const, attemptCount: 1,
  outcomeState: "ready", latestSourceVersionId: "version-1",
};
const reviewedOverwriteInput = (): ReviewedOverwriteInput => ({
  target: { id: "target-1", entityType: "organization", values: { phone: "555-LOCAL" } },
  field: "phone",
  value: "555-ACT",
  expectedLocalValue: "555-LOCAL",
  expectedLocalValueFingerprint: localValueFingerprint("555-LOCAL"),
  origin: { entityType: "organization", entityId: "target-1", fieldName: "phone", sourceRecordId: "source-1", sourceVersionId: "version-1", operationId: storedOperation.id, sourceValueFingerprint: "source-fingerprint" },
  operation: { ...storedOperation, action: "overwrite_reviewed", status: "applied" },
});
type TestQuery = Parameters<PgDialect["sqlToQuery"]>[0];
const withSuccessfulFences = (database: { execute: (query: TestQuery) => Promise<unknown> }) => {
  const dialect = new PgDialect();
  const execute = async (query: TestQuery) => {
    const rendered = dialect.sqlToQuery(query).sql;
    if (rendered.startsWith("update act_replacement_runs")) return { rows: [{ id: "run-1" }] };
    if (rendered.startsWith("update act_replacement_apply_batches set lease_expires_at")) return { rows: [{ id: attempt.batchId }] };
    return database.execute(query);
  };
  return { execute, transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }) };
};

describe("DrizzleApplyRepository", () => {
  it("advertises durable apply and is created lazily from an injected database", () => {
    const database = {} as never;
    const repository = createDrizzleApplyRepository(database);
    expect(repository).toBeInstanceOf(DrizzleApplyRepository);
    expect(repository.durableApply).toBe(true);
  });

  it("loads durable approval provenance for apply authorization", async () => {
    const dialect = new PgDialect();
    let statement = "";
    const database = {
      execute: async (query: TestQuery) => {
        statement = dialect.sqlToQuery(query).sql;
        return { rows: [{
          manifestDigest: "digest-1",
          approvedOperationIds: ["operation-1"],
          approvalMode: "explicit_manual",
          approvalModeVersion: 1,
        }] };
      },
    } as never;

    await expect(new DrizzleApplyRepository(database).getApproval("run-1", "request-1"))
      .resolves.toEqual({
        manifestDigest: "digest-1",
        approvedOperationIds: ["operation-1"],
        approvalMode: "explicit_manual",
        approvalModeVersion: 1,
      });
    expect(statement).toContain("approval_mode as \"approvalMode\"");
    expect(statement).toContain("approval_mode_version as \"approvalModeVersion\"");
  });

  it("fails closed for unsupported target types before any SQL is issued", async () => {
    const database = { execute: async () => { throw new Error("SQL must not run"); } } as never;
    const repository = new DrizzleApplyRepository(withSuccessfulFences(database) as never);
    await expect(repository.createTarget("arbitrary_table", { normalized: {} }, "source-1", undefined, attempt))
      .rejects.toMatchObject({ code: "unsupported_target_type" });
  });

  it("atomically rejects a batch claim unless the run phase, manifest digest, and organizer lease still match", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const transaction = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        return { rows: [] };
      },
    };
    const database = {
      transaction: async (callback: (tx: typeof transaction) => Promise<unknown>) => callback(transaction),
      execute: transaction.execute,
    } as never;

    await expect(new DrizzleApplyRepository(database).createBatch({
      batchId: "batch-1", runId: "run-1", requestKey: "approval:0", approvalRequestKey: "approval", startCursor: 0,
      manifestDigest: "digest-1", operationIds: ["approved-1"], state: "applying", attemptToken: attempt.attemptToken,
    })).rejects.toMatchObject({ code: "apply_run_not_claimable" });

    expect(statements[0]).toContain("update act_replacement_runs");
    expect(statements[0]).toContain("summary->>'manifestDigest'");
    expect(statements[0]).toContain("organizer_token is null");
    expect(statements[0]).toContain("phase in ('ready_to_apply','applying','complete_with_issues')");
    expect(statements.some((statement) => statement.includes("act_replacement_apply_batches"))).toBe(false);
  });

  it("requires the current unexpired attempt token before mutating an operation", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      statements.push(dialect.sqlToQuery(query).sql);
      return { rows: [] };
    };
    const database = {
      execute,
      transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }),
    } as never;

    await expect(new DrizzleApplyRepository(database).saveOperation(storedOperation, attempt))
      .rejects.toMatchObject({ code: "apply_attempt_lost" });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("attempt_token");
    expect(statements[0]).toContain("lease_expires_at > now()");
    expect(statements.some((statement) => statement.includes("act_replacement_apply_operations"))).toBe(false);
  });

  it("atomically CASes the reviewed value, origin, and terminal operation behind the apply-attempt fence", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    let transactions = 0;
    const execute = async (query: TestQuery) => {
      const rendered = dialect.sqlToQuery(query).sql;
      statements.push(rendered);
      if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.startsWith("with overwritten as")) return { rows: [{ operationId: storedOperation.id }] };
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = {
      execute,
      transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => {
        transactions += 1;
        return callback({ execute });
      },
    } as never;
    await new DrizzleApplyRepository(database).applyReviewedOverwrite(reviewedOverwriteInput(), attempt);

    expect(transactions).toBe(1);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("attempt_token");
    expect(statements[0]).toContain("lease_expires_at > now()");
    expect(statements[1]).toContain("update organizations");
    expect(statements[1]).toContain("phone is not distinct from");
    expect(statements[1]).toContain("insert into act_imported_field_origins");
    expect(statements[1]).toContain("from overwritten");
    expect(statements[1]).toContain("update act_replacement_apply_operations");
    expect(statements[1]).toContain("exists (select 1 from origin)");
    expect(statements[1]).toContain("status = 'applied'");
  });

  it("returns local_edit_detected when the reviewed CAS updates zero rows without writing audit state", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = async (query: TestQuery) => {
      const rendered = dialect.sqlToQuery(query).sql;
      statements.push(rendered);
      if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.startsWith("with overwritten as")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = {
      execute,
      transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }),
    } as never;
    await expect(new DrizzleApplyRepository(database).applyReviewedOverwrite(reviewedOverwriteInput(), attempt))
      .rejects.toMatchObject({ code: "local_edit_detected" });

    expect(statements).toHaveLength(2);
  });

  it.each([
    ["contact", "firstName", "first_name"],
    ["contact", "address1", "address_1"],
    ["contact", "postalCode", "postal_code"],
    ["organization", "address1", "address_1"],
    ["organization", "address2", "address_2"],
    ["organization", "industry", "act_industry"],
    ["organization", "postalCode", "postal_code"],
    ["booking", "venueName", "venue_name"],
  ])("maps normalized %s.%s to writable physical column %s", async (entityType, field, physical) => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const rendered = dialect.sqlToQuery(query).sql;
      statements.push(rendered);
      if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      return { rows: [] };
    };
    const database = {
      execute,
      transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }),
    } as never;

    await new DrizzleApplyRepository(database).writeTarget({ id: "target-1", entityType, values: {} }, field, "value", attempt);
    expect(statements.at(-1)).toContain(`set ${physical} =`);
  });

  it("rejects unsupported normalized target fields before acquiring a write fence", async () => {
    const database = { execute: async () => { throw new Error("SQL must not run"); }, transaction: async () => { throw new Error("transaction must not run"); } } as never;
    await expect(new DrizzleApplyRepository(database).writeTarget(
      { id: "target-1", entityType: "organization", values: {} },
      "arbitraryField",
      "value",
      attempt,
    )).rejects.toMatchObject({ code: "unsupported_target_field" });
  });

  it("conditionally fills a blank mapped column and re-reads a concurrent local edit in the fenced transaction", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const rendered = dialect.sqlToQuery(query).sql;
      statements.push(rendered);
      if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.startsWith("update organizations")) return { rows: [] };
      if (rendered.startsWith("select phone as value")) return { rows: [{ value: "concurrent-local-edit", sameValue: false }] };
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = {
      execute,
      transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }),
    } as never;
    const repository = new DrizzleApplyRepository(database);

    const result = await (repository as unknown as {
      fillMissingTarget(target: { id: string; entityType: string; values: Record<string, unknown> }, field: string, value: unknown, applyAttempt: typeof attempt): Promise<string>;
    }).fillMissingTarget({ id: "target-1", entityType: "organization", values: { phone: null } }, "phone", "source-value", attempt);

    expect(result).toBe("local_value_nonempty");
    expect(statements[1]).toContain("where id =");
    expect(statements[1]).toContain("phone is null or phone =");
    expect(statements[1]).toContain("returning phone as value");
    expect(statements[2]).toContain("phone is not distinct from");
  });

  it("uses null-only fill predicates for timestamp columns", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const rendered = dialect.sqlToQuery(query).sql;
      statements.push(rendered);
      if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.startsWith("update activities")) return { rows: [{ value: new Date("2026-08-07T12:00:00.000Z") }] };
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = { execute, transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) } as never;

    await new DrizzleApplyRepository(database).fillMissingTarget(
      { id: "booking-1", entityType: "activity", values: { sourceOccurredAt: null } },
      "sourceOccurredAt",
      "2026-08-07T12:00:00.000Z",
      attempt,
    );

    expect(statements[1]).toContain("occurred_at is null");
    expect(statements[1]).not.toContain("occurred_at is null or");
  });

  it.each([
    ["2026-08-07T12:00:00.000Z", true, "already_present"],
    ["2026-08-08T12:00:00.000Z", false, "local_value_nonempty"],
  ] as const)("uses PostgreSQL typed equality for a stored timestamp versus %s", async (payload, sameValue, expected) => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    const execute = async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
      const rendered = dialect.sqlToQuery(query).sql;
      statements.push(rendered);
      if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.startsWith("update activities")) return { rows: [] };
      if (rendered.startsWith("select occurred_at as value")) {
        return { rows: [{ value: new Date("2026-08-07T12:00:00.000Z"), ...(rendered.includes("is not distinct from") ? { sameValue } : {}) }] };
      }
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = { execute, transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) } as never;

    await expect(new DrizzleApplyRepository(database).fillMissingTarget(
      { id: "booking-1", entityType: "activity", values: { sourceOccurredAt: null } },
      "sourceOccurredAt",
      payload,
      attempt,
    )).resolves.toBe(expected);
    expect(statements[2]).toContain("occurred_at is not distinct from");
  });

  it("durably records an idempotent external source link", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        if (rendered.includes("from act_source_records")) {
          return { rows: [{ sourceDatabaseKey: "act-db", streamType: "company", actRecordId: "company-act-1" }] };
        }
        if (rendered.includes("from act_external_links")) return { rows: [] };
        if (rendered.includes("from organizations")) {
          return { rows: [{ id: "organization-1", actRecordId: "source-1" }] };
        }
        if (rendered.startsWith("update act_external_links")) return { rows: [] };
        if (rendered.startsWith("insert into act_external_links")) return { rows: [] };
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;
    const repository = new DrizzleApplyRepository(withSuccessfulFences(database) as never);

    await repository.recordProvenance({
      id: "provenance-1",
      operationKey: "provenance:source-1",
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      targetType: "organization",
      action: "record_provenance",
      payload: {},
      dependencyOperationKeys: ["organization:source-1"],
      requiredForSourceOutcome: false,
      safeByDefault: true,
      status: "leased",
      attemptCount: 1,
      outcomeState: "ready",
      latestSourceVersionId: "version-1",
    }, attempt);

    expect(statements.some((statement) => statement.startsWith("insert into act_external_links"))).toBe(true);
    expect(statements.at(-1)).toContain("on conflict (source_record_id)");
  });

  it("upgrades a matching legacy calling-list link with the source UUID instead of inserting a duplicate", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        if (rendered.includes("from act_source_records")) return { rows: [{ sourceDatabaseKey: "act-db", streamType: "group", actRecordId: "ACT-GROUP-1" }] };
        if (rendered.includes("from act_external_links") && rendered.includes("source_record_id =")) return { rows: [] };
        if (rendered.includes("from act_external_links") && rendered.includes("source_record_id is null")) return { rows: [{ id: "calling-list-1", name: "Leads", kind: "static" }] };
        if (rendered.startsWith("update act_external_links")) return { rows: [{ id: "legacy-link-1" }] };
        if (rendered.startsWith("insert into act_external_links")) throw new Error("must not duplicate the legacy identity");
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;
    const repository = new DrizzleApplyRepository(withSuccessfulFences(database) as never);

    await expect(repository.recordProvenance({
      ...storedOperation,
      id: "provenance-1",
      operationKey: "provenance:source-1",
      sourceRecordId: "source-1",
      sourceVersionId: "version-1",
      targetType: "calling_list",
      action: "record_provenance",
      payload: {},
    }, attempt)).resolves.toBeUndefined();

    expect(statements.some((statement) => statement.startsWith("update act_external_links"))).toBe(true);
    expect(statements.some((statement) => statement.startsWith("insert into act_external_links"))).toBe(false);
  });

  it("atomically claims a queued approval row without replacing its closure", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    let state = "queued";
    let fingerprint: string | null = null;
    let leaseOwner: string | null = null;
    let leaseExpiresAt: Date | null = null;
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        if (rendered.startsWith("update act_replacement_apply_batches")) {
          state = "applying";
          fingerprint = "fingerprint-1";
          leaseOwner = "owner-1";
          leaseExpiresAt = new Date("2026-08-07T12:02:00.000Z");
          return { rows: [{ id: "approval-batch" }] };
        }
        if (rendered.includes("from act_replacement_apply_batches")) return { rows: [{ id: "approval-batch", runId: "run-1", requestKey: "request-1", manifestDigest: "digest-1", operationIds: ["approved-1"], state, fingerprint, leaseOwner, leaseExpiresAt }] };
        if (rendered.includes("from act_replacement_apply_operations")) return { rows: [{ id: "operation-1", runId: "run-1", sourceRecordId: "source-1", sourceVersionId: "version-1", operationKey: "approved-1", targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true, status: "pending", attemptCount: 0, lastErrorCode: null }] };
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;
    const repository = new DrizzleApplyRepository(withSuccessfulFences(database) as never);

    const claim = await repository.createBatch({ batchId: "replacement", runId: "run-1", requestKey: "request-1", manifestDigest: "digest-1", operationIds: ["approved-1"], state: "applying", fingerprint: "fingerprint-1", leaseOwner: "owner-1", leaseExpiresAt: new Date("2026-08-07T12:02:00.000Z").getTime(), attemptToken: attempt.attemptToken });

    expect(claim).toMatchObject({ claimed: true, batch: { batchId: "approval-batch", state: "applying", operationIds: ["approved-1"], fingerprint: "fingerprint-1", leaseOwner: "owner-1" } });
    expect(statements.filter((statement) => statement.startsWith("update act_replacement_apply_batches"))).toHaveLength(1);
    expect(statements.some((statement) => statement.startsWith("insert into act_replacement_apply_batches"))).toBe(false);
    const assignments = statements[0]?.split(" where ")[0];
    expect(assignments).not.toContain("selected_operation_ids =");
    expect(assignments).not.toContain("dependency_closed_operation_ids =");
  });

  it("returns an existing applying batch as an unclaimed race loss", async () => {
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [] };
        if (rendered.includes("from act_replacement_apply_batches")) return { rows: [{ id: "approval-batch", runId: "run-1", requestKey: "request-1", manifestDigest: "digest-1", operationIds: ["approved-1"], state: "applying", fingerprint: "fingerprint-1", leaseOwner: "owner-1", leaseExpiresAt: new Date("2026-08-07T12:02:00.000Z") }] };
        if (rendered.includes("from act_replacement_apply_operations")) return { rows: [{ id: "operation-1", runId: "run-1", sourceRecordId: "source-1", sourceVersionId: "version-1", operationKey: "approved-1", targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true, status: "pending", attemptCount: 0, lastErrorCode: null }] };
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;

    const result = await new DrizzleApplyRepository(withSuccessfulFences(database) as never).createBatch({ batchId: "replacement", runId: "run-1", requestKey: "request-1", manifestDigest: "digest-1", operationIds: ["approved-1"], state: "applying", fingerprint: "fingerprint-1", leaseOwner: "owner-1", leaseExpiresAt: new Date("2026-08-07T12:02:00.000Z").getTime(), attemptToken: attempt.attemptToken });

    expect(result).toMatchObject({ claimed: false, batch: { batchId: "approval-batch", state: "applying" } });
  });

  it("reports an insert-conflict race loser as unclaimed", async () => {
    const dialect = new PgDialect();
    let batchReads = 0;
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [] };
        if (rendered.includes("from act_replacement_apply_batches")) {
          batchReads += 1;
          if (batchReads === 1) return { rows: [] };
          return { rows: [{ id: "winning-batch", runId: "run-1", requestKey: "request-1", approvalRequestKey: "approval", startCursor: 0, manifestDigest: "digest-1", operationIds: ["approved-1"], state: "applying", fingerprint: "fingerprint-1", leaseOwner: "winner", leaseExpiresAt: new Date("2026-08-07T12:02:00.000Z") }] };
        }
        if (rendered.startsWith("insert into act_replacement_apply_batches")) return { rows: [] };
        if (rendered.includes("from act_replacement_apply_operations")) return { rows: [{ id: "operation-1", runId: "run-1", sourceRecordId: "source-1", sourceVersionId: "version-1", operationKey: "approved-1", targetType: "organization", action: "create", payload: {}, dependencyOperationKeys: [], requiredForSourceOutcome: true, safeByDefault: true, status: "pending", attemptCount: 0, lastErrorCode: null }] };
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;

    const result = await new DrizzleApplyRepository(withSuccessfulFences(database) as never).createBatch({ batchId: "replacement", runId: "run-1", requestKey: "request-1", approvalRequestKey: "approval", startCursor: 0, manifestDigest: "digest-1", operationIds: ["approved-1"], state: "applying", fingerprint: "fingerprint-1", leaseOwner: "loser", leaseExpiresAt: new Date("2026-08-07T12:02:00.000Z").getTime(), attemptToken: attempt.attemptToken });

    expect(result).toMatchObject({ claimed: false, batch: { batchId: "winning-batch", leaseOwner: "winner" } });
  });

  it("maps activity archive timestamps, type, source UUIDs, and version UUIDs", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query);
        statements.push({ sql: rendered.sql, params: rendered.params });
        if (rendered.sql.includes("from activities") && rendered.sql.startsWith("select")) return { rows: [] };
        if (rendered.sql.startsWith("insert into activities")) return { rows: [{ id: "activity-local" }] };
        throw new Error(`Unexpected SQL: ${rendered.sql}`);
      },
    } as never;

    await new DrizzleApplyRepository(withSuccessfulFences(database) as never).createTarget("activity", {
      category: "note", sourceType: "note", body: "Archived note", subject: "Subject", sourceOccurredAt: "2026-08-01T10:00:00.000Z", timelineSortAt: "2026-08-01T10:00:00.000Z", dateIsImportFallback: false, endsAt: null, status: null,
    }, "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", attempt);

    const insert = statements.find((statement) => statement.sql.startsWith("insert into activities"));
    expect(insert?.sql).toContain("source_record_id");
    expect(insert?.sql).toContain("source_version_id");
    expect(insert?.sql).toContain("occurred_at");
    expect(insert?.params).toEqual(expect.arrayContaining(["note", "Archived note", "2026-08-01T10:00:00.000Z", "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222"]));
  });

  it("uses external links for calling lists and true Act IDs for native target columns", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query);
        statements.push({ sql: rendered.sql, params: rendered.params });
        if (rendered.sql.includes("from act_external_links")) return { rows: [] };
        if (rendered.sql.includes("from act_source_records")) return { rows: [{ sourceDatabaseKey: "act-db", streamType: "company", actRecordId: "ACT-COMPANY-1" }] };
        if (rendered.sql.includes("from organizations") && rendered.sql.startsWith("select")) return { rows: [] };
        if (rendered.sql.startsWith("insert into organizations")) return { rows: [{ id: "organization-local" }] };
        throw new Error(`Unexpected SQL: ${rendered.sql}`);
      },
    } as never;
    const repository = new DrizzleApplyRepository(withSuccessfulFences(database) as never);

    await expect(repository.findTargetBySource("calling_list", "11111111-1111-1111-1111-111111111111")).resolves.toBeNull();
    await repository.createTarget("organization", { name: "Adventure Zone" }, "11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", attempt);

    expect(statements.some((statement) => /from calling_lists where act_record_id/.test(statement.sql))).toBe(false);
    const insert = statements.find((statement) => statement.sql.startsWith("insert into organizations"));
    expect(insert?.params).toContain("ACT-COMPANY-1");
    expect(insert?.params).not.toContain("11111111-1111-1111-1111-111111111111");
  });

  it("creates an ACT contact with canonical legacy-phone normalization", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: TestQuery) => {
        const rendered = dialect.sqlToQuery(query);
        statements.push({ sql: rendered.sql, params: rendered.params });
        if (rendered.sql.includes("from act_external_links") && rendered.sql.includes("source_record_id =")) return { rows: [] };
        if (rendered.sql.includes("from act_source_records")) return { rows: [{ sourceDatabaseKey: "act-db", streamType: "contact", actRecordId: "ACT-CONTACT-1" }] };
        if (rendered.sql.includes("from act_external_links") && rendered.sql.includes("source_record_id is null")) return { rows: [] };
        if (rendered.sql.startsWith("select * from contacts")) return { rows: [] };
        if (rendered.sql.startsWith("insert into contacts")) return { rows: [{ id: "contact-local", phone: "(701) 555-0199", normalized_phone: "+17015550199" }] };
        throw new Error(`Unexpected SQL: ${rendered.sql}`);
      },
    } as never;

    await new DrizzleApplyRepository(withSuccessfulFences(database) as never).createTarget(
      "contact",
      { firstName: "Ada", lastName: "Lovelace", phone: "(701) 555-0199" },
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      attempt,
    );

    const insert = statements.find((statement) => statement.sql.startsWith("insert into contacts"));
    expect(insert?.sql).toContain("normalized_phone");
    expect(insert?.params).toEqual(expect.arrayContaining(["(701) 555-0199", "+17015550199"]));
  });

  it("updates and clears ACT contact phone normalization in the same statement", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const execute = async (query: TestQuery) => {
      const rendered = dialect.sqlToQuery(query);
      statements.push({ sql: rendered.sql, params: rendered.params });
      if (rendered.sql.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.sql.startsWith("update contacts")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${rendered.sql}`);
    };
    const repository = new DrizzleApplyRepository({
      execute,
      transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }),
    } as never);
    const target = { id: "contact-local", entityType: "contact", values: { phone: null } };

    await repository.writeTarget(target, "phone", "701.555.0199", attempt);
    await repository.writeTarget(target, "phone", null, attempt);

    const updates = statements.filter((statement) => statement.sql.startsWith("update contacts"));
    expect(updates).toHaveLength(2);
    expect(updates[0]?.sql).toContain("normalized_phone =");
    expect(updates[0]?.params).toEqual(expect.arrayContaining(["701.555.0199", "+17015550199"]));
    expect(updates[1]?.sql).toContain("normalized_phone =");
    expect(updates[1]?.params).toEqual(expect.arrayContaining([null, null]));
  });

  it("canonically normalizes an ACT phone filled into a blank contact", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const execute = async (query: TestQuery) => {
      const rendered = dialect.sqlToQuery(query);
      statements.push({ sql: rendered.sql, params: rendered.params });
      if (rendered.sql.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.sql.startsWith("update contacts")) return { rows: [{ value: "701-555-0199" }] };
      throw new Error(`Unexpected SQL: ${rendered.sql}`);
    };
    const database = { execute, transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }) } as never;

    await expect(new DrizzleApplyRepository(database).fillMissingTarget(
      { id: "contact-local", entityType: "contact", values: { phone: null } },
      "phone",
      "701-555-0199",
      attempt,
    )).resolves.toBe("applied");

    const update = statements.find((statement) => statement.sql.startsWith("update contacts"));
    expect(update?.sql).toContain("normalized_phone =");
    expect(update?.params).toEqual(expect.arrayContaining(["701-555-0199", "+17015550199"]));
  });

  it("canonically normalizes a reviewed ACT contact phone overwrite", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const execute = async (query: TestQuery) => {
      const rendered = dialect.sqlToQuery(query);
      statements.push({ sql: rendered.sql, params: rendered.params });
      if (rendered.sql.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
      if (rendered.sql.startsWith("with overwritten as")) return { rows: [{ operationId: storedOperation.id }] };
      throw new Error(`Unexpected SQL: ${rendered.sql}`);
    };
    const database = { execute, transaction: async <T>(callback: (tx: { execute: typeof execute }) => Promise<T>) => callback({ execute }) } as never;
    const input = reviewedOverwriteInput();
    input.target = { id: "contact-local", entityType: "contact", values: { phone: "701-555-0100" } };
    input.value = "+1 701 555 0199";
    input.expectedLocalValue = "701-555-0100";
    input.expectedLocalValueFingerprint = localValueFingerprint("701-555-0100");
    input.origin = { ...input.origin, entityType: "contact", entityId: "contact-local" };

    await new DrizzleApplyRepository(database).applyReviewedOverwrite(input, attempt);

    const update = statements.find((statement) => statement.sql.startsWith("with overwritten as"));
    expect(update?.sql).toContain("normalized_phone =");
    expect(update?.params).toEqual(expect.arrayContaining(["+1 701 555 0199", "+17015550199"]));
  });

  it("persists ACT phone create, update, and clear through exact lookup and destination constraints", async () => {
    const client = new PGlite();
    try {
      await client.exec(`
        CREATE TABLE contacts (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid,
          first_name text NOT NULL, last_name text NOT NULL, email text, phone text,
          normalized_phone text, act_record_id text UNIQUE, job_title text,
          address_1 text, address_2 text, city text, region text, postal_code text,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE contact_phones (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
          number text NOT NULL, normalized_number text, type text NOT NULL DEFAULT 'unknown',
          extension text, label text, "primary" boolean NOT NULL DEFAULT false,
          source text NOT NULL DEFAULT 'local', do_not_call_at timestamptz, do_not_call_reason text,
          created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE UNIQUE INDEX contact_phones_one_primary_per_contact ON contact_phones(contact_id) WHERE "primary";
        CREATE TABLE call_sessions (id uuid PRIMARY KEY, phone_id uuid REFERENCES contact_phones(id) ON DELETE SET NULL);
        CREATE TABLE act_source_records (
          id text PRIMARY KEY, source_database_key text NOT NULL, stream_type text NOT NULL, act_record_id text NOT NULL
        );
        CREATE TABLE act_external_links (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entity_type text NOT NULL, entity_id uuid NOT NULL,
          source_entity_type text NOT NULL, act_record_id text NOT NULL, source_database_key text,
          source_record_id text
        );
        CREATE TABLE act_replacement_apply_batches (
          id text PRIMARY KEY, attempt_token text, state text NOT NULL,
          lease_expires_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now()
        );
      `);
      const migration = (await loadActReviewMigrations()).find(({ name }) => name === "023_contact_phone_canonical_dnc.sql");
      await client.exec(migration!.sql);
      await client.exec(`
        INSERT INTO act_source_records (id, source_database_key, stream_type, act_record_id)
        VALUES ('source-1', 'act-db', 'contact', 'ACT-CONTACT-1');
        INSERT INTO act_replacement_apply_batches (id, attempt_token, state, lease_expires_at)
        VALUES ('${attempt.batchId}', '${attempt.attemptToken}', 'applying', now() + interval '5 minutes');
      `);
      const database = drizzle(client) as never;
      const repository = new DrizzleApplyRepository(database);

      const created = await repository.createTarget(
        "contact",
        { firstName: "Ada", lastName: "Lovelace", phone: "(701) 555-0199" },
        "source-1",
        "version-1",
        attempt,
      );
      const contactId = created.target.id;

      expect((await client.query(`
        SELECT number, normalized_number, "primary" FROM contact_phones WHERE contact_id = '${contactId}'
      `)).rows).toEqual([{ number: "(701) 555-0199", normalized_number: "+17015550199", primary: true }]);
      await expect(new DrizzleContactRepository(database).findCallerExactMetadata({
        normalizedPhone: "+17015550199",
        normalizedEmail: null,
      })).resolves.toEqual({ exactPhoneContactIds: [contactId], hasExactEmail: false });
      await expect(new DrizzleContactRepository(database).hasExactQuickCallerDuplicate({
        requestKey: "22222222-2222-4222-8222-222222222222",
        firstName: "Grace",
        lastName: "Hopper",
        organizationName: "",
        phone: "701.555.0199",
        email: null,
        reason: "New inquiry",
        eventDate: null,
        eventLocation: null,
        continueCreating: false,
      })).resolves.toBe(true);
      await expect(client.query(`
        INSERT INTO contact_phones (contact_id, number, normalized_number)
        VALUES ('${contactId}', '+1 701 555 0199', '+17015550199')
      `)).rejects.toMatchObject({ code: "23505" });

      await repository.writeTarget(created.target, "phone", "701-555-0100", attempt);
      expect((await client.query(`
        SELECT number, normalized_number, "primary" FROM contact_phones
        WHERE contact_id = '${contactId}' ORDER BY created_at, id
      `)).rows).toEqual(expect.arrayContaining([
        { number: "(701) 555-0199", normalized_number: "+17015550199", primary: false },
        { number: "701-555-0100", normalized_number: "+17015550100", primary: true },
      ]));

      await repository.writeTarget(created.target, "phone", null, attempt);
      expect((await client.query(`SELECT phone, normalized_phone FROM contacts WHERE id = '${contactId}'`)).rows)
        .toEqual([{ phone: null, normalized_phone: null }]);
      expect((await client.query(`SELECT count(*)::int AS count FROM contact_phones WHERE contact_id = '${contactId}' AND "primary"`)).rows)
        .toEqual([{ count: 0 }]);
    } finally {
      await client.close();
    }
  });

  it("creates a calling list and its source link in one idempotent SQL statement", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        if (rendered.includes("from act_external_links")) return { rows: [] };
        if (rendered.includes("from act_source_records")) return { rows: [{ sourceDatabaseKey: "act-db", streamType: "group", actRecordId: "ACT-GROUP-1" }] };
        if (rendered.startsWith("with locked as materialized")) return { rows: [{ id: "calling-list-local", name: "Leads", kind: "static", alreadyPresent: false }] };
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;

    const result = await new DrizzleApplyRepository(withSuccessfulFences(database) as never).createTarget(
      "calling_list",
      { name: "Leads" },
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      attempt,
    );

    expect(result.alreadyPresent).toBe(false);
    const atomic = statements.find((statement) => statement.startsWith("with locked as materialized"));
    expect(atomic).toContain("insert into calling_lists");
    expect(atomic).toContain("insert into act_external_links");
    expect(statements.filter((statement) => statement.startsWith("insert into calling_lists"))).toHaveLength(0);
  });

  it("applies a reviewed relationship directly to the selected local parent id", async () => {
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: TestQuery) => {
        const rendered = dialect.sqlToQuery(query);
        statements.push({ sql: rendered.sql, params: rendered.params });
        if (rendered.sql.startsWith("select * from activities where source_record_id")) return { rows: [{ id: "activity-local" }] };
        if (rendered.sql.startsWith("select * from organizations where id")) return { rows: [{ id: "organization-local" }] };
        if (rendered.sql.startsWith("insert into activity_associations")) return { rows: [{ inserted: 1 }] };
        throw new Error(`Unexpected SQL: ${rendered.sql}`);
      },
    } as never;
    const operation = {
      ...storedOperation,
      targetType: "activity_association" as const,
      action: "create_relationship" as const,
      sourceRecordId: "activity-source",
      payload: {
        parentEntityId: "organization-local",
        parentType: "organization",
        relationshipSlot: "timeline-parent",
      },
    };

    await expect(new DrizzleApplyRepository(withSuccessfulFences(database) as never)
      .createRelationship(operation, attempt)).resolves.toBe("applied");

    expect(statements.some((statement) => statement.sql.includes("from act_source_records"))).toBe(false);
    const link = statements.find((statement) => statement.sql.startsWith("insert into activity_associations"));
    expect(link?.params).toEqual(expect.arrayContaining(["activity-local", "organization-local"]));
  });

  it("resolves a legacy Act-ID calling-list link before create and cannot duplicate it", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const database = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        if (rendered.includes("from act_external_links") && rendered.includes("source_record_id =")) return { rows: [] };
        if (rendered.includes("from act_source_records")) return { rows: [{ sourceDatabaseKey: "act-db", streamType: "group", actRecordId: "ACT-GROUP-1" }] };
        if (rendered.includes("from act_external_links") && rendered.includes("source_record_id is null")) {
          return { rows: [{ id: "legacy-calling-list", name: "Legacy leads", kind: "static" }] };
        }
        throw new Error(`Unexpected SQL: ${rendered}`);
      },
    } as never;
    const repository = new DrizzleApplyRepository(withSuccessfulFences(database) as never);

    await expect(repository.findTargetBySource("calling_list", "11111111-1111-1111-1111-111111111111"))
      .resolves.toMatchObject({ id: "legacy-calling-list", entityType: "calling_list" });
    await expect(repository.createTarget(
      "calling_list",
      { name: "Legacy leads" },
      "11111111-1111-1111-1111-111111111111",
      "22222222-2222-2222-2222-222222222222",
      attempt,
    )).resolves.toMatchObject({ target: { id: "legacy-calling-list" }, alreadyPresent: true });

    expect(statements.some((statement) => statement.startsWith("with locked as materialized"))).toBe(false);
    expect(statements.some((statement) => statement.startsWith("insert into calling_lists"))).toBe(false);
  });

  it("finishes a batch and projects terminal source outcomes in one transaction", async () => {
    const statements: string[] = [];
    const dialect = new PgDialect();
    const transaction = {
      execute: async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const rendered = dialect.sqlToQuery(query).sql;
        statements.push(rendered);
        if (rendered.startsWith("update act_replacement_apply_batches")) return { rows: [{ id: attempt.batchId }] };
        return { rows: [] };
      },
    };
    const database = {
      transaction: async (callback: (tx: typeof transaction) => Promise<void>) => callback(transaction),
    } as never;

    await new DrizzleApplyRepository(withSuccessfulFences(transaction) as never).finishBatch({
      batchId: "batch-1",
      runId: "run-1",
      requestKey: "approval:0",
      manifestDigest: "digest",
      operationIds: ["organization:source-1", "provenance:source-1"],
      state: "complete",
      completed: 2,
      alreadyPresent: 0,
      blocked: 0,
      failed: 0,
    }, attempt);

    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("update act_replacement_outcomes");
    expect(statements[0]).toContain("with current_operations as");
    expect(statements[0]).toContain("operations.manifest_generation is not distinct from runs.manifest_generation");
    expect(statements[0]).toContain("status not in ('applied','already_present')");
    expect(statements[1]).toContain("update act_replacement_apply_batches");
  });
});
