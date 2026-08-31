import { describe, expect, it, vi } from "vitest";

import { ensureOwnerAccountSchemaBeforeListen } from "./owner-account-required-startup";

describe("ensureOwnerAccountSchemaBeforeListen", () => {
  it("holds a dedicated advisory lock while creating the owner schema", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ locked: true }] })
      .mockResolvedValue({ rows: [] });
    const release = vi.fn();
    const ensureSchema = vi.fn().mockResolvedValue(true);

    const applied = await ensureOwnerAccountSchemaBeforeListen({
      pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
      ensureSchema,
    });

    expect(applied).toBe(true);
    expect(ensureSchema).toHaveBeenCalledOnce();
    expect(query.mock.calls[0]?.[0]).toContain("pg_try_advisory_lock");
    expect(query.mock.calls.at(-1)?.[0]).toContain("pg_advisory_unlock");
    expect(release).toHaveBeenCalledOnce();
  });

  it("fails closed and releases the client when the schema lock is busy", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ locked: false }] });
    const release = vi.fn();

    await expect(
      ensureOwnerAccountSchemaBeforeListen({
        pool: { connect: vi.fn().mockResolvedValue({ query, release }) },
        ensureSchema: vi.fn(),
      }),
    ).rejects.toThrow("OWNER_ACCOUNT_SCHEMA_LOCK_BUSY");
    expect(release).toHaveBeenCalledOnce();
  });
});
