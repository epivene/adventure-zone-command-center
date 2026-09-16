// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("profile decision palette", () => {
  it("uses the approved paper, ink, accent, gold, teal, and divider colors", () => {
    const list = readFileSync(
      "src/components/organizations/organization-list.tsx",
      "utf8",
    );
    const glance = readFileSync(
      "src/components/profiles/profile-at-a-glance.tsx",
      "utf8",
    );
    const detail = readFileSync(
      "src/components/profiles/simple-full-profile.tsx",
      "utf8",
    );

    expect(list).toContain("#f6f2e9");
    expect(list).toContain("#fffefa");
    expect(list).toContain("#182225");
    expect(list).toContain("#536064");
    expect(list).toContain("#d8d1c4");
    expect(list).toContain("#e85d35");
    expect(list).toContain("#efb33f");
    expect(list).toContain("#157d78");
    expect(glance).toContain('data-testid="profile-detail-header"');
    expect(glance).toContain("bg-[#182225]");
    expect(glance).not.toContain("gradient");
    expect(detail).toContain("ProfileEmailSummary");
    expect(detail).toContain("Quick email");
  });
});
