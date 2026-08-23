import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const todaySource = readFileSync("src/pages/TodayPage.tsx", "utf8");
const summarySource = readFileSync("src/components/today/summary-cards.tsx", "utf8");

describe("simple Today layout", () => {
  it("organizes the daily screen around Start here, My Work, Coming up, and Later", () => {
    const startHere = todaySource.indexOf("Start here");
    const myWork = todaySource.indexOf("My Work");
    const comingUp = todaySource.indexOf("Coming up");
    const later = todaySource.indexOf("Later");
    expect(startHere).toBeGreaterThan(-1);
    expect(myWork).toBeGreaterThan(startHere);
    expect(comingUp).toBeGreaterThan(myWork);
    expect(later).toBeGreaterThan(comingUp);
    expect(todaySource).toContain("FollowUpList");
  });

  it("hides zero-value summary cards in the reusable summary component", () => {
    expect(summarySource).toContain("visibleCards");
    expect(summarySource).toContain("if (!visibleCards.length) return null");
  });
});
