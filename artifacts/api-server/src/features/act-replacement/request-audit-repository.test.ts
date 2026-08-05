import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { db as applicationDatabase } from "@/db/client";
import * as schema from "@workspace/db/schema";
import {
  ActRequestAuditRepositoryError,
  DrizzleActRequestAuditRepository,
  isSafeActPathTemplate,
} from "./request-audit-repository";

describe("Act request audit metadata", () => {
  it.each([
    "/authorize",
    "/api/companies",
    "/api/contacts/{id}",
    "/api/opportunities/{id}/companies",
    "/api/activities/{id}/opportunities",
    "/api/notes/{id}/contacts",
    "/api/history/{id}/companies",
  ])("accepts the exact normalized template %s", (pathTemplate) => {
    expect(isSafeActPathTemplate(pathTemplate)).toBe(true);
  });

  it.each([
    "/api/contacts/private-id",
    "/api/contacts/{id}?$select=id",
    "https://apius.act.com/act.web.api/api/contacts",
    "/api/contacts/{id}/unknown",
  ])("rejects non-template or request-bearing path %s", (pathTemplate) => {
    expect(isSafeActPathTemplate(pathTemplate)).toBe(false);
  });

  it("wraps storage failures in a credential-free error", async () => {
    const repository = new DrizzleActRequestAuditRepository({
      insert() {
        throw new Error("password=hunter2 Authorization=Bearer-secret");
      },
    } as never);

    const caught = await repository
      .begin({
        runId: "run-1",
        checkpointId: "checkpoint-1",
        streamType: "contact",
        method: "GET",
        pathTemplate: "/api/contacts",
        startedAt: new Date("2026-08-04T12:00:00.000Z"),
      })
      .catch((error: unknown) => error);

    expect(caught).toEqual(new ActRequestAuditRepositoryError());
    expect(JSON.stringify(caught)).not.toContain("hunter2");
    expect(JSON.stringify(caught)).not.toContain("Bearer-secret");
  });

  it("rejects an unknown stream before touching storage", async () => {
    let insertCalls = 0;
    const repository = new DrizzleActRequestAuditRepository({
      insert() {
        insertCalls += 1;
        return {
          values() {
            return { returning: async () => [{ auditId: "unsafe" }] };
          },
        };
      },
    } as never);

    await expect(
      repository.begin({
        runId: "run-1",
        checkpointId: "checkpoint-1",
        streamType: "private_stream" as never,
        method: "GET",
        pathTemplate: "/api/contacts",
        startedAt: new Date("2026-08-04T12:00:00.000Z"),
      }),
    ).rejects.toEqual(new ActRequestAuditRepositoryError());
    expect(insertCalls).toBe(0);
  });
});

const describeWithPostgres = process.env.TEST_DATABASE_URL
  ? describe
  : describe.skip;

describeWithPostgres("Act request audits on PostgreSQL", () => {
  type QueryResult<Row> = { rows: Row[] };
  type TestPool = {
    query<Row = Record<string, unknown>>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>>;
    end(): Promise<void>;
  };

  const schemaName = `act_request_audit_${randomUUID().replaceAll("-", "")}`;
  const quotedSchema = `"${schemaName}"`;
  let pool: TestPool;
  let repository: DrizzleActRequestAuditRepository;

  beforeAll(async () => {
    const pgModuleUrl = new URL(
      "../../../../../lib/db/node_modules/pg/lib/index.js",
      import.meta.url,
    );
    const pgModule = (await import(pgModuleUrl.href)) as {
      default: {
        Pool: new (config: {
          connectionString: string;
          options: string;
        }) => TestPool;
      };
    };
    pool = new pgModule.default.Pool({
      connectionString: process.env.TEST_DATABASE_URL!,
      options: `-c search_path=${schemaName},public`,
    });
    await pool.query(`CREATE SCHEMA ${quotedSchema}`);
    const migrationPath = fileURLToPath(
      new URL(
        "../../../../../lib/db/migrations/006_act_replacement_archive.sql",
        import.meta.url,
      ),
    );
    await pool.query(await readFile(migrationPath, "utf8"));
    const database = drizzle(pool as never, {
      schema,
    }) as unknown as typeof applicationDatabase;
    repository = new DrizzleActRequestAuditRepository(database);
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    await pool.end();
  });

  it("commits started evidence separately and finishes only safe metadata", async () => {
    const run = await pool.query<{ id: string }>(
      `INSERT INTO act_replacement_runs
         (request_key, source_database_key, requested_by, page_size)
       VALUES ($1, 'database-a', 'owner', 100)
       RETURNING id`,
      [randomUUID()],
    );
    const checkpoint = await pool.query<{ id: string }>(
      `INSERT INTO act_replacement_checkpoints
         (run_id, source_database_key, stream_type, checkpoint_kind,
          partition_key, requiredness, page_size, state)
       VALUES ($1, 'database-a', 'contact', 'list', 'root:contact',
               'required', 100, 'leased')
       RETURNING id`,
      [run.rows[0]!.id],
    );
    const startedAt = new Date("2026-08-04T12:00:00.000Z");
    const completedAt = new Date("2026-08-04T12:00:00.025Z");

    const { auditId } = await repository.begin({
      runId: run.rows[0]!.id,
      checkpointId: checkpoint.rows[0]!.id,
      streamType: "contact",
      method: "GET",
      pathTemplate: "/authorize",
      startedAt,
    });

    const started = await pool.query<{ document: Record<string, unknown> }>(
      "SELECT to_jsonb(a) document FROM act_replacement_request_audits a WHERE id = $1",
      [auditId],
    );
    expect(started.rows[0]?.document).toMatchObject({
      state: "started",
      method: "GET",
      path_template: "/authorize",
      http_status: null,
      safe_error_code: null,
      duration_ms: null,
      completed_at: null,
    });
    expect(Object.keys(started.rows[0]!.document)).not.toEqual(
      expect.arrayContaining([
        "url",
        "query",
        "headers",
        "body",
        "credentials",
      ]),
    );

    await repository.finish({
      auditId,
      state: "failed",
      httpStatus: 429,
      safeErrorCode: "rate_limited",
      durationMs: 25,
      completedAt,
    });

    const finished = await pool.query<{
      state: string;
      http_status: number;
      safe_error_code: string;
      duration_ms: number;
    }>(
      `SELECT state, http_status, safe_error_code, duration_ms
       FROM act_replacement_request_audits WHERE id = $1`,
      [auditId],
    );
    expect(finished.rows).toEqual([
      {
        state: "failed",
        http_status: 429,
        safe_error_code: "rate_limited",
        duration_ms: 25,
      },
    ]);
  });
});
