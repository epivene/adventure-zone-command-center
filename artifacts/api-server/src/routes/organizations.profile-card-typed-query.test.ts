import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const routeSource = fs.readFileSync(path.resolve(__dirname, "organizations.ts"), "utf8");

describe("profile card enrichment query contract", () => {
  it("loads profile photos with individually parameterized UUIDs instead of one array parameter", () => {
    expect(routeSource).toContain("profile_image_data_url");
    expect(routeSource).toContain("sql.join");
    expect(routeSource).not.toContain("any(${ids}::uuid[])");
  });

  it("uses the active primary contact for card email/phone instead of a nonexistent organization email column", () => {
    expect(routeSource).toContain("organization_contacts");
    expect(routeSource).toContain("is_primary");
    expect(routeSource).toContain("contacts");
    expect(routeSource).toContain("coalesce(c.phone, o.phone)");
    expect(routeSource).toContain("c.email");
    expect(routeSource).not.toContain("o.email");
  });
});
