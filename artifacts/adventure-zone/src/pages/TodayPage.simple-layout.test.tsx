import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const todaySource = readFileSync("src/pages/TodayPage.tsx", "utf8");
const summarySource = readFileSync("src/components/today/summary-cards.tsx", "utf8");

describe("simple Today layout", () => {
  it("orders the main work queue around Up Next Follow-ups Upcoming Events and Needs Attention", () => {
    const upNext = todaySource.indexOf("Up Next");
    const upcoming = todaySource.indexOf("Upcoming Events");
    const attention = todaySource.indexOf("NeedsAttention");
    expect(upNext).toBeGreaterThan(-1);
    expect(todaySource).toContain("FollowUpList");
    expect(upcoming).toBeGreaterThan(upNext);
    expect(attention).toBeGreaterThan(upcoming);
  });

  it("hides zero-value summary cards", () => {
    expect(summarySource).toContain("visibleCards");
    expect(summarySource).toContain("if (!visibleCards.length) return null");
  });
});
