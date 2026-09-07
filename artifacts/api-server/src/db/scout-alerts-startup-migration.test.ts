import { describe, expect, it, vi } from "vitest";

import { ensureScoutAlertsSchema } from "./scout-alerts-startup-migration";

describe("ensureScoutAlertsSchema", () => {
  it("does nothing when both Scout Alert tables and required indexes are ready", async () => {
    const query = vi.fn(async (_sql: string) => ({ rows: [{ ready: true }] }));

    await expect(ensureScoutAlertsSchema({ query })).resolves.toBe(false);

    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0]?.[0]).toContain("scout_alert_watches_due_idx");
    expect(query.mock.calls[0]?.[0]).toContain("scout_alerts_visible_idx");
  });

  it("applies additive Scout Alert DDL when the marker is incomplete", async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({ rows: [{ ready: false }] })
      .mockResolvedValueOnce({ rows: [] });

    await expect(ensureScoutAlertsSchema({ query })).resolves.toBe(true);

    expect(query).toHaveBeenCalledTimes(2);
    const ddl = String(query.mock.calls[1]?.[0]);
    expect(ddl).toContain("create table if not exists scout_alert_watches");
    expect(ddl).toContain("create table if not exists scout_alerts");
    expect(ddl).toContain("status in ('active','paused','complete')");
    expect(ddl).toContain("kind in ('application_opened','deadline_approaching','dates_announced','dates_changed','contact_changed','needs_verification','monitoring_problem')");
    expect(ddl).toContain("severity in ('info','attention','urgent')");
    expect(ddl).toContain("status in ('open','snoozed','dismissed','resolved')");
    expect(ddl).toContain("create unique index if not exists scout_alerts_fingerprint_unique");
    expect(ddl).toContain("create index if not exists scout_alert_watches_due_idx");
    expect(ddl).toContain("create index if not exists scout_alerts_visible_idx");
  });
});
