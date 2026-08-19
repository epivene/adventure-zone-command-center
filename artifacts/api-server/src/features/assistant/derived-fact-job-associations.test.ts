import { describe, expect, it } from "vitest";
import type { Pool } from "pg";

import { extractDerivedFactsForProfile } from "./derived-fact-job";

describe("extractDerivedFactsForProfile activity scope", () => {
  it("includes ACT activities linked to an organization through activity_associations", async () => {
    const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as unknown as Pool;

    const result = await extractDerivedFactsForProfile({
      organizationId: "11111111-1111-4111-8111-111111111111",
      pool,
    });

    expect(result.activityCount).toBe(0);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("activity_associations");
    expect(queries[0]?.text).toContain("associated.organization_id = $1");
    expect(queries[0]?.values).toEqual(["11111111-1111-4111-8111-111111111111"]);
  });

  it("includes ACT activities linked to a contact through activity_associations", async () => {
    const queries: Array<{ text: string; values: unknown[] | undefined }> = [];
    const pool = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values });
        return { rows: [] };
      },
    } as unknown as Pool;

    await extractDerivedFactsForProfile({
      contactId: "22222222-2222-4222-8222-222222222222",
      pool,
    });

    expect(queries[0]?.text).toContain("associated.contact_id = $1");
    expect(queries[0]?.values).toEqual(["22222222-2222-4222-8222-222222222222"]);
  });
});
