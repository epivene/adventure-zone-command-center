import { describe, expect, it, vi } from "vitest";

import { ensurePackageIntelligenceSchema } from "./package-intelligence-schema";

describe("ensurePackageIntelligenceSchema", () => {
  it("uses ordinary Pirate wording when it fills blank existing package fields", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });

    await ensurePackageIntelligenceSchema({ query } as never);

    const migrationSql = query.mock.calls[0]?.[0] as string;
    const pirateUpdate = migrationSql.slice(
      migrationSql.indexOf("UPDATE package_templates\n    SET customer_description = 'A water-focused pirate"),
      migrationSql.indexOf("UPDATE package_templates\n    SET customer_description = 'A smaller five-attraction"),
    );
    expect(pirateUpdate).toContain("ordinary three-unit package");
    expect(pirateUpdate).not.toMatch(/massive pool|extremely.flat|45,000|50,000/i);
    expect(pirateUpdate).toContain("nullif(trim(customer_description), '') IS NULL");
  });
});
