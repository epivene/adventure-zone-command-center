import { describe, expect, it } from "vitest";
import { projectBossGlance } from "./boss-profile-view";

describe("Boss At a Glance projection", () => {
  it("retains decision facts and public date evidence without private strategy", () => {
    const result = projectBossGlance({
      place: { name: "County Fair", applicationDeadline: "2027-03-01", recommendedDealModel: "flat_fee", lastResortReason: "private strategy", actRecordId: "ACT-private" },
      effectiveEventDate: { startsOn: "2027-07-01", endsOn: "2027-07-03", displayStatus: "confirmed", sourceId: "active-fact" },
      eventDateFacts: [
        { id: "active-fact", active: true, startsOn: "2027-07-01", status: "confirmed", sourceTitle: "Official fair calendar", sourceUrl: "https://example.org/dates", sourceRecordId: "private-import" },
        { id: "old-fact", active: false, startsOn: "2026-07-01", status: "confirmed" },
      ],
      sourceProvenance: [{ actRecordId: "ACT-private" }],
    } as any, { priority: "high", pipelineStatus: "contacted", nextActionKind: "call", nextActionDueAt: "2027-02-01" });
    expect(result.place).toEqual({ name: "County Fair", applicationDeadline: "2027-03-01", recommendedDealModel: "flat_fee" });
    expect(result.effectiveEventDate?.startsOn).toBe("2027-07-01");
    expect(result.eventDateFacts).toEqual([{ id: "active-fact", startsOn: "2027-07-01", status: "confirmed", sourceTitle: "Official fair calendar", sourceUrl: "https://example.org/dates" }]);
    expect(result.decisionSummary.nextActionKind).toBe("call");
    expect(JSON.stringify(result)).not.toMatch(/private|lastResort|sourceProvenance|actRecordId/);
  });
});
