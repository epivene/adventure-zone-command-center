import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
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
      if (rendered.startsWith("update bookings")) return { rows: [{ value: new Date("2026-08-07T12:00:00.000Z") }] };
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = { execute, transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) } as never;

    await new DrizzleApplyRepository(database).fillMissingTarget(
      { id: "booking-1", entityType: "booking", values: { startsAt: null } },
      "startsAt",
      "2026-08-07T12:00:00.000Z",
      attempt,
    );

    expect(statements[1]).toContain("starts_at is null");
    expect(statements[1]).not.toContain("starts_at is null or");
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
      if (rendered.startsWith("update bookings")) return { rows: [] };
      if (rendered.startsWith("select starts_at as value")) {
        return { rows: [{ value: new Date("2026-08-07T12:00:00.000Z"), ...(rendered.includes("is not distinct from") ? { sameValue } : {}) }] };
      }
      throw new Error(`Unexpected SQL: ${rendered}`);
    };
    const database = { execute, transaction: async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }) } as never;

    await expect(new DrizzleApplyRepository(database).fillMissingTarget(
      { id: "booking-1", entityType: "booking", values: { startsAt: null } },
      "startsAt",
      payload,
      attempt,
    )).resolves.toBe(expected);
    expect(statements[2]).toContain("starts_at is not distinct from");
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
    expect(statements[0]).toContain("status not in ('applied','already_present')");
    expect(statements[1]).toContain("update act_replacement_apply_batches");
  });
});
