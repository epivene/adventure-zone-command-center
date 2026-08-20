import { describe, expect, it } from "vitest";

import { DEFAULT_PACKAGE_TEMPLATE_SEED_SQL } from "./package-defaults";

describe("default package template seed", () => {
  it("creates only genuinely missing package templates with starter prices", () => {
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("'adventure_zone'");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("'weekend_warriors'");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("'warriors_playground'");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("'pirates_rebellion'");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("'pirate_rebellion'");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("800000");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toContain("700000");
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toMatch(/NOT EXISTS[\s\S]*weekend_warriors[\s\S]*warriors_playground/i);
    expect(DEFAULT_PACKAGE_TEMPLATE_SEED_SQL).toMatch(/NOT EXISTS[\s\S]*pirates_rebellion[\s\S]*pirate_rebellion/i);
  });
});
