import { describe, expect, it } from "vitest";

import {
  inspectOrganizationReferenceBlockers,
  type ReferenceInspectorExecutor,
} from "./organization-reference-inspector";

class FakeExecutor implements ReferenceInspectorExecutor {
  readonly calls: Array<{ text: string; values?: unknown[] }> = [];
  private count = 0;

  async query<Row extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Row[] }> {
    this.calls.push({ text, values });
    this.count += 1;
    if (this.count === 1) {
      return {
        rows: [
          { schemaName: "public", tableName: "organizations", columnName: "consolidated_into_id" },
          { schemaName: "public", tableName: "activities", columnName: "organization_id" },
          { schemaName: "odd-schema", tableName: "quoted\"table", columnName: "org\"id" },
        ] as unknown as Row[],
      };
    }
    if (this.count === 2) return { rows: [{ count: 2 }] as unknown as Row[] };
    if (this.count === 3) return { rows: [{ count: 0 }] as unknown as Row[] };
    return { rows: [{ count: 1 }] as unknown as Row[] };
  }
}

describe("inspectOrganizationReferenceBlockers", () => {
  it("returns only populated incoming foreign-key references with safely quoted identifiers", async () => {
    const executor = new FakeExecutor();

    const blockers = await inspectOrganizationReferenceBlockers(
      "08e8e9b8-618a-4129-ab14-640345c1abf0",
      executor,
    );

    expect(blockers).toEqual([
      {
        schemaName: "public",
        tableName: "organizations",
        columnName: "consolidated_into_id",
        count: 2,
      },
      {
        schemaName: "odd-schema",
        tableName: "quoted\"table",
        columnName: "org\"id",
        count: 1,
      },
    ]);
    expect(executor.calls[1]?.text).toContain('"public"."organizations"');
    expect(executor.calls[1]?.text).toContain('"consolidated_into_id"');
    expect(executor.calls[3]?.text).toContain('"odd-schema"."quoted""table"');
    expect(executor.calls[3]?.text).toContain('"org""id"');
    expect(executor.calls.slice(1).every((call) => call.values?.[0] === "08e8e9b8-618a-4129-ab14-640345c1abf0")).toBe(true);
  });
});
