import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./MarketingCampaignsPage.tsx", import.meta.url), "utf8");

describe("Marketing campaign audiences", () => {
  it("offers both smart and manual audience creation", () => {
    expect(source).toContain("Smart list");
    expect(source).toContain("Manual list");
    expect(source).toContain("Pick exact profiles");
  });

  it("only searches email-ready profiles for manual lists", () => {
    expect(source).toContain('hasEmail: "yes"');
    expect(source).toContain("Only profiles with an email address can be added");
  });

  it("stores selected profile ids and shows manual recipient counts in campaigns", () => {
    expect(source).toContain("profileIds: string[]");
    expect(source).toContain('kind: "manual"');
    expect(source).toContain("item.kind === \"manual\" ? item.profileIds.length : item.estimatedCount");
  });
});
