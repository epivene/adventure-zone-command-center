import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import * as crmSchema from "@/db/schema";
import {
  createDrizzleTodayDashboardRepository,
  TODAY_FOLLOW_UP_PAGE_SIZE,
} from "@/features/follow-ups/today-query";
import { crmTestDatabaseUrl } from "@/tests/helpers/crm-test-database";

const databaseUrl = crmTestDatabaseUrl();
const migrationDirectory = path.resolve(import.meta.dirname, "../../db/migrations");

function testSchemaName() {
  return `today_priority_${randomUUID().replaceAll("-", "_")}`;
}

async function migrationStatements(fileName: string, schemaName: string) {
  const contents = await readFile(path.join(migrationDirectory, fileName), "utf8");
  return contents
    .replaceAll('"public".', `"${schemaName}".`)
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

describe("Today priority pagination (PostgreSQL)", () => {
  const postgresTest = databaseUrl ? it : it.skip;
  let sql: postgres.Sql | undefined;
  let schemaName = "";

  beforeEach(async () => {
    if (!databaseUrl) return;
    schemaName = testSchemaName();
    sql = postgres(databaseUrl, { max: 1 });
    await sql.unsafe(`CREATE SCHEMA "${schemaName}"`);
    await sql.unsafe(`SET search_path TO "${schemaName}", public`);
    const journal = JSON.parse(
      await readFile(path.join(migrationDirectory, "meta", "_journal.json"), "utf8"),
    ) as { entries: { tag: string }[] };
    for (const entry of journal.entries) {
      for (const statement of await migrationStatements(`${entry.tag}.sql`, schemaName)) {
        await sql.unsafe(statement);
      }
    }
  });

  afterEach(async () => {
    if (!sql) return;
    try {
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`);
    } finally {
      await sql.end({ timeout: 5 });
      sql = undefined;
    }
  });

  postgresTest("puts a later deadline on page one ahead of 50 earlier low-priority rows", async () => {
    const db = drizzle({ client: sql!, schema: crmSchema });
    const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const deadlineId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await db.insert(crmSchema.organizations).values({
      id: organizationId,
      name: "Today priority regression",
    });
    await db.insert(crmSchema.followUps).values([
      ...Array.from({ length: TODAY_FOLLOW_UP_PAGE_SIZE }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        organizationId,
        kind: "email",
        dueAt: new Date("2026-08-04T18:00:00.000Z"),
        createdAt: new Date(Date.UTC(2026, 7, 1, 12, 0, index)),
      })),
      {
        id: deadlineId,
        organizationId,
        kind: "contract_deadline",
        dueAt: new Date("2026-08-10T18:00:00.000Z"),
        createdAt: new Date("2026-08-02T18:00:00.000Z"),
      },
    ]);

    const result = await createDrizzleTodayDashboardRepository(
      db,
    ).listOpenFollowUps({
      page: 1,
      pageSize: TODAY_FOLLOW_UP_PAGE_SIZE,
      now: new Date("2026-08-03T14:00:00.000Z"),
    });

    expect(result.total).toBe(TODAY_FOLLOW_UP_PAGE_SIZE + 1);
    expect(result.records).toHaveLength(TODAY_FOLLOW_UP_PAGE_SIZE);
    expect(result.records[0]?.followUp.id).toBe(deadlineId);
    expect(result.records.map((row) => row.followUp.id)).toContain(deadlineId);
  });
});
