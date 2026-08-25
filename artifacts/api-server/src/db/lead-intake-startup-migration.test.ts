import { describe, expect, it, vi } from "vitest";

import { ensureLeadIntakeSchema } from "./lead-intake-startup-migration";

describe("ensureLeadIntakeSchema", () => {
  it("checks every review column plus critical constraints before declaring the schema ready", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ ready: true }] });
    const loadSql = vi.fn();

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence");
    expect(query.mock.calls[0]?.[0]).toContain("review_version");
    expect(query.mock.calls[0]?.[0]).toContain("confirmed_recipient_email");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_rows_confirmed_date_range_valid");
    expect(query.mock.calls[0]?.[0]).toContain("lead_import_evidence_one_selected_field");
    expect(loadSql).not.toHaveBeenCalled();
  });

  it("runs both lead-intake migrations when the schema is incomplete", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ready: false }] })
      .mockResolvedValueOnce({ rows: [] });
    const loadSql = vi.fn().mockResolvedValue("-- base migration\n-- review evidence migration");

    await expect(ensureLeadIntakeSchema({ query }, { loadSql })).resolves.toBe(true);
    expect(loadSql).toHaveBeenCalledOnce();
    expect(query).toHaveBeenLastCalledWith("-- base migration\n-- review evidence migration");
  });
});
