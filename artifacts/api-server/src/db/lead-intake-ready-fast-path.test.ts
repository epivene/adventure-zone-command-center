import { describe, expect, it, vi } from "vitest";

import { ensureLeadIntakeSchema } from "./lead-intake-startup-migration";

describe("lead intake startup ready fast path", () => {
  it("does not replay migrations when the canonical schema is already ready", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ ready: true }] });
    const loadSql = vi.fn().mockResolvedValue("-- expensive migration bundle");

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(false);

    expect(loadSql).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence");
  });
});
