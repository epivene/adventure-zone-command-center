import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  lockOrganizationFamilyMutationSnapshot,
  lockOrganizationHierarchyMutationDomain,
} from "./organization-family-lock";

function normalizedSql(query: unknown): string {
  return new PgDialect()
    .sqlToQuery(query as SQL)
    .sql.replaceAll(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

describe("organization family lock order", () => {
  it("locks the shared advisory domain before every authoritative family table", async () => {
    const statements: string[] = [];
    const transaction = {
      execute: async (query: unknown) => {
        statements.push(normalizedSql(query));
        return { rows: [] };
      },
    };

    await lockOrganizationFamilyMutationSnapshot(transaction as never);

    expect(statements).toHaveLength(3);
    expect(statements[0]).toContain("pg_advisory_xact_lock");
    expect(statements[1]).toBe('lock table "organizations" in exclusive mode');
    expect(statements[2]).toBe(
      'lock table "act_migration_records", "act_external_links" in share mode',
    );
  });

  it("makes hierarchy changes enter the advisory domain before taking row locks", async () => {
    const statements: string[] = [];
    await lockOrganizationHierarchyMutationDomain({
      execute: async (query: unknown) => {
        statements.push(normalizedSql(query));
        return { rows: [] };
      },
    } as never);

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("pg_advisory_xact_lock");
  });
});
