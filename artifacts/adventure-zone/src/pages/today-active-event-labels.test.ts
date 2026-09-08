import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const today = fs.readFileSync(path.resolve(__dirname, "TodayPage.tsx"), "utf8");
const upcoming = fs.readFileSync(path.resolve(__dirname, "../../../api-server/src/features/follow-ups/today-upcoming-events.ts"), "utf8");

describe("Today lead and event labels", () => {
  it("uses queue-scoped new lead count", () => {
    expect(today).toContain("countQueueNewLeads(nextStepItems, followUps)");
    expect(today).toContain("New leads in queue");
    expect(today).not.toContain("{dashboard.newLeadCount ?? 0} New leads</span>");
  });

  it("distinguishes active events from future events", () => {
    expect(today).toContain("Current & upcoming events");
    expect(today).toContain("In progress");
    expect(today).toContain("classifyTodayEventTiming(event, now)");
    expect(upcoming).toContain("endsAt: effectiveEnd");
  });
});
