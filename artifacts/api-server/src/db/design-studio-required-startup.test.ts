import { describe, expect, it, vi } from "vitest";

import { ensureDesignStudioSchemaBeforeListen } from "./design-studio-required-startup";

describe("ensureDesignStudioSchemaBeforeListen", () => {
  it("runs idempotent Studio DDL before listening and releases the connection", async () => {
    const queries: string[] = [];
    const client = {
      query: vi.fn(async (query: string) => {
        queries.push(query);
        return { rows: [] };
      }),
      release: vi.fn(),
    };
    const pool = { connect: vi.fn(async () => client) };

    await expect(ensureDesignStudioSchemaBeforeListen({ pool })).resolves.toBe(true);

    expect(queries[0]).toBe("SET lock_timeout = '5s'");
    expect(queries[1]).toContain("CREATE TABLE IF NOT EXISTS design_projects");
    expect(queries[1]).toContain("CREATE TABLE IF NOT EXISTS design_project_versions");
    expect(queries[1]).toContain("CREATE TABLE IF NOT EXISTS design_outputs");
    expect(queries[2]).toBe("RESET lock_timeout");
    expect(client.release).toHaveBeenCalledOnce();
  });
});