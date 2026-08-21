import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import { ensureOfficeCoordinatorSchemaBeforeListen } from "./office-coordinator-required-startup";

function fakeClient() {
  return {
    query: vi.fn(async () => ({ rows: [] })),
    release: vi.fn(),
  };
}

describe("ensureOfficeCoordinatorSchemaBeforeListen", () => {
  it("runs the Office Coordinator schema while holding a startup advisory lock", async () => {
    const client = fakeClient();
    const ensureSchema = vi.fn(async () => true);
    const pool = { connect: vi.fn(async () => client) };

    await expect(
      ensureOfficeCoordinatorSchemaBeforeListen({ pool, ensureSchema }),
    ).resolves.toBe(true);

    expect(client.query).toHaveBeenNthCalledWith(
      1,
      "SELECT pg_advisory_lock(hashtext('adventure-zone:office-coordinator-schema'))",
    );
    expect(ensureSchema).toHaveBeenCalledWith(client);
    expect(client.query).toHaveBeenLastCalledWith(
      "SELECT pg_advisory_unlock(hashtext('adventure-zone:office-coordinator-schema'))",
    );
    expect(client.release).toHaveBeenCalledOnce();
  });

  it("ensures the Office Coordinator schema before the server accepts requests", () => {
    const source = readFileSync(path.resolve(process.cwd(), "src/index.ts"), "utf8");
    const ensureAt = source.indexOf('"required office coordinator schema"');
    const listenAt = source.indexOf("const server = app.listen");

    expect(ensureAt).toBeGreaterThan(-1);
    expect(listenAt).toBeGreaterThan(-1);
    expect(ensureAt).toBeLessThan(listenAt);
  });
});
