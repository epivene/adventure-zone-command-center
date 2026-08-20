import { describe, expect, it } from "vitest";

import { LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL } from "./test-fixture-cleanup";

describe("leaked consolidation fixture cleanup", () => {
  it("matches only the known empty Double-Run Fairs test signature", () => {
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toContain("Double-Run Fairs");
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toContain("Repeat Fair A");
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toContain("Repeat Fair B");
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toContain("Rockford");
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toContain("Aurora");
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toMatch(/NOT EXISTS[\s\S]*organization_contacts/i);
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toMatch(/NOT EXISTS[\s\S]*bookings/i);
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toMatch(/NOT EXISTS[\s\S]*activities/i);
    expect(LEAKED_CONSOLIDATION_FIXTURE_CLEANUP_SQL).toMatch(/NOT EXISTS[\s\S]*follow_ups/i);
  });
});
