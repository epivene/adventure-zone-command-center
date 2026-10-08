import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { orderMigrations } from "./migration-order";

describe("migration prerequisite ordering", () => {
  it("keeps independent migrations in filename order", () => {
    expect(orderMigrations(["003.sql", "001.sql", "002.sql"])).toEqual(["001.sql", "002.sql", "003.sql"]);
  });

  it("orders the real planner before allocation and its dependent upgrades", () => {
    const files = readdirSync(new URL("../migrations/", import.meta.url)).filter(file => file.endsWith(".sql"));
    const ordered = orderMigrations(files);
    expect(ordered.indexOf("20260909_outreach_planner.sql")).toBeLessThan(ordered.indexOf("20260909_outreach_allocation.sql"));
    for (const file of ["20260909_outreach_commitments.sql", "20260909_outreach_dispatch.sql"]) {
      expect(ordered.indexOf("20260909_outreach_allocation.sql")).toBeLessThan(ordered.indexOf(file));
    }
    expect([...ordered].sort()).toEqual([...files].sort());
    expect(new Set(ordered).size).toBe(files.length);
    const related = new Set([
      "20260909_outreach_planner.sql", "20260909_outreach_allocation.sql",
      "20260909_outreach_commitments.sql", "20260909_outreach_dispatch.sql",
    ]);
    expect(ordered.filter(file => !related.has(file))).toEqual(files.filter(file => !related.has(file)).sort());
  });

  it("rejects a missing prerequisite rather than silently omitting an upgrade", () => {
    expect(() => orderMigrations(["allocation.sql"], { "allocation.sql": ["planner.sql"] })).toThrow("Missing migration prerequisite: planner.sql");
  });

  it("rejects cyclic prerequisites", () => {
    expect(() => orderMigrations(["a.sql", "b.sql"], { "a.sql": ["b.sql"], "b.sql": ["a.sql"] })).toThrow("Cyclic migration prerequisite");
  });
});
