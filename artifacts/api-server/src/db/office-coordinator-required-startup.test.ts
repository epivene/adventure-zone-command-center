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
});
