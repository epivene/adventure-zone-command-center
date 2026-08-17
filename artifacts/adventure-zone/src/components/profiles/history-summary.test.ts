import { describe, expect, it } from "vitest";
import { historyCategory, simplifyHistoryText } from "./history-summary";

describe("profile history summaries", () => {
  it("turns ACT field churn into plain language", () => {
    expect(simplifyHistoryText('Field Stage changed from "Adventure Zone Process/Initial Contact" to "Adventure Zone Process/Promo Email Received"')).toBe("Stage changed to Promo Email Received");
    expect(simplifyHistoryText('Field Probability of Close changed from "10" to "0"')).toBe("Booking likelihood changed from 10% to 0%");
    expect(simplifyHistoryText('Field Opportunity Name changed from "New Opportunity" to "Utah Juneteenth Festival"')).toBe("Renamed opportunity to Utah Juneteenth Festival");
    expect(simplifyHistoryText('A new opportunity called New Opportunity was created')).toBe("New opportunity created");
  });

  it("keeps human notes separate from system history even when imported", () => {
    expect(historyCategory({ kind: "note", body: "Called organizer", importedFromAct: true })).toBe("notes");
    expect(historyCategory({ kind: "history", body: "Field Stage changed from A to B", importedFromAct: true })).toBe("system");
  });
});
