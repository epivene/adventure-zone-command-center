import { describe, expect, it, vi } from "vitest";

import { ensureCommunicationTemplateReviewSetSchemaBeforeListen } from "./communication-template-review-set-required-startup";

describe("ensureCommunicationTemplateReviewSetSchemaBeforeListen", () => {
  it("creates and verifies the review-set columns before API readiness", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (query: string) => {
        queries.push(query);
        if (query.includes("AS ready")) return { rows: [{ ready: true }] };
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureCommunicationTemplateReviewSetSchemaBeforeListen({ pool }),
    ).resolves.toBe(true);

    expect(queries[0]).toBe("SET lock_timeout = '5s'");
    expect(queries[1]).toContain("ADD COLUMN IF NOT EXISTS position integer");
    expect(queries[1]).toContain("template_name_snapshot text");
    expect(queries[1]).toContain("verified_links jsonb");
    expect(queries[1]).toContain("DROP INDEX IF EXISTS communication_template_reviews_request_unique");
    expect(queries[1]).toContain("communication_template_reviews_request_position_unique");
    expect(queries[2]).toContain("AS ready");
    expect(queries[3]).toBe("RESET lock_timeout");
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("fails startup when the required columns are still unavailable", async () => {
    const client = {
      query: vi.fn(async (query: string) =>
        query.includes("AS ready") ? { rows: [{ ready: false }] } : { rows: [] }),
      release: vi.fn(),
    };

    await expect(
      ensureCommunicationTemplateReviewSetSchemaBeforeListen({
        pool: { connect: vi.fn(async () => client) },
      }),
    ).rejects.toThrow("Communication template review-set schema is incomplete");
    expect(client.release).toHaveBeenCalledOnce();
  });
});
