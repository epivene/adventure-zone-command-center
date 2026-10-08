import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const todaySource = readFileSync("src/pages/TodayPage.tsx", "utf8");
const summarySource = readFileSync("src/components/today/summary-cards.tsx", "utf8");
const mainSource = readFileSync("src/main.tsx", "utf8");

describe("simple Today layout", () => {
  it("puts the unified workspace ahead of supporting tools and schedule", () => {
    const daily = todaySource.indexOf("<DailyWorkspace");
    const tools = todaySource.indexOf(">Booking tools<");
    const comingUp = todaySource.indexOf("Coming up");
    expect(daily).toBeGreaterThan(-1);
    expect(tools).toBeGreaterThan(daily);
    expect(comingUp).toBeGreaterThan(tools);
    expect(todaySource).not.toContain("<FollowUpList");
    expect(todaySource).not.toContain("<NextCallCard");
  });

  it("separates due-now follow-ups from future scheduled work", () => {
    expect(todaySource).toContain("actionableFollowUps");
    expect(todaySource).toContain("dueTodayFollowUps");
    const workspace = readFileSync("src/components/today/daily-workspace.tsx", "utf8");
    expect(workspace).toContain("Waiting &amp; scheduled");
    expect(workspace).toContain("showLater");
  });

  it("opens a targeted details panel from same-page shortcuts", () => {
    expect(mainSource).toContain("target instanceof HTMLDetailsElement");
    expect(mainSource).toContain("target.open = true");
    expect(mainSource).toContain("target.scrollIntoView");
  });

  it("hides zero-value summary cards in the reusable summary component", () => {
    expect(summarySource).toContain("visibleCards");
    expect(summarySource).toContain("if (!visibleCards.length) return null");
  });
});