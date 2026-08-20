import { describe, expect, it } from "vitest";

import { ensurePackageIntelligenceSchema } from "./package-intelligence-schema";

describe("ensurePackageIntelligenceSchema package templates", () => {
  it("self-heals the three default package templates without duplicating legacy aliases", async () => {
    const queries: string[] = [];
    const pool = {
      query: async (sql: string) => {
        queries.push(sql);
        return { rows: [] };
      },
    } as any;

    await ensurePackageIntelligenceSchema(pool);

    const sql = queries.join("\n");
    expect(sql).toContain("'adventure_zone'");
    expect(sql).toContain("'weekend_warriors'");
    expect(sql).toContain("'warriors_playground'");
    expect(sql).toContain("'pirates_rebellion'");
    expect(sql).toContain("'pirate_rebellion'");
    expect(sql).toContain("800000");
    expect(sql).toContain("700000");
    expect(sql).toMatch(/NOT EXISTS[\s\S]*weekend_warriors[\s\S]*warriors_playground/i);
    expect(sql).toMatch(/NOT EXISTS[\s\S]*pirates_rebellion[\s\S]*pirate_rebellion/i);
  });
});
