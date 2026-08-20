import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queue = readFileSync("src/components/today/call-queue-workspace.tsx", "utf8");
const script = readFileSync("src/components/calls/guided-call-script-card.tsx", "utf8");
const workspace = readFileSync("src/components/calls/call-workspace.tsx", "utf8");
const briefing = readFileSync("src/components/calls/call-briefing-card.tsx", "utf8");

describe("guided calling console visual hierarchy", () => {
  it("uses a compact Call Prep header and clearer selected queue state", () => {
    expect(queue).toContain("Call Prep");
    expect(queue).toContain("Selected");
    expect(queue).toContain("Start guided call");
    expect(queue).toContain("size-12");
    expect(queue).toContain("Assistant & Needs Answer");
  });

  it("makes the active script dominant and mobile-sticky", () => {
    expect(script).toContain("Say this");
    expect(script).toContain("text-2xl");
    expect(script).toContain("min-h-14");
    expect(script).toContain("sticky");
    expect(script).toContain("Call outcome & save");
    expect(script).toContain('href="#call-details-title"');
  });

  it("keeps quick facts and history secondary", () => {
    expect(briefing).toContain("Quick facts & history");
    expect(briefing).toContain("<details");
    expect(workspace).toContain("Recent history");
    expect(workspace).toContain("<details");
  });
});
