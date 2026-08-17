import { describe, expect, it } from "vitest";
import { historyCategory, htmlToPlainText, simplifyHistoryText } from "./history-summary";

describe("profile history summaries", () => {
  it("turns ACT field churn into plain language", () => {
    expect(simplifyHistoryText('Field Stage changed from "Adventure Zone Process/Initial Contact" to "Adventure Zone Process/Promo Email Received"')).toBe("Stage changed to Promo Email Received");
    expect(simplifyHistoryText('Field Probability of Close changed from "10" to "0"')).toBe("Booking likelihood changed from 10% to 0%");
    expect(simplifyHistoryText('Field Opportunity Name changed from "New Opportunity" to "Utah Juneteenth Festival"')).toBe("Renamed opportunity to Utah Juneteenth Festival");
    expect(simplifyHistoryText('A new opportunity called New Opportunity was created')).toBe("New opportunity created");
  });

  it("keeps human ACT prose under Notes even when ACT labels it history", () => {
    expect(historyCategory({ kind: "history", body: "Called organizer", importedFromAct: true, actSourceType: "note" })).toBe("notes");
    expect(historyCategory({ kind: "history", body: "Hi Breck Create, We'd love to come to your festival.", importedFromAct: true, actSourceType: "history" })).toBe("notes");
    expect(historyCategory({ kind: "history", body: '<div><p>Hi Breck Create,</p><p>We represent The Adventure Zone.</p></div>', importedFromAct: true, actSourceType: "history" })).toBe("notes");
  });

  it("keeps bookkeeping, linked records, and blank updates under System", () => {
    expect(historyCategory({ kind: "history", body: "Field Stage changed from A to B", importedFromAct: true, actSourceType: "history" })).toBe("system");
    expect(historyCategory({ kind: "history", body: "A new opportunity called New Opportunity was created", importedFromAct: true, actSourceType: "history" })).toBe("system");
    expect(historyCategory({ kind: "history", body: "Linked contact Amy Smith", importedFromAct: true, actSourceType: "history" })).toBe("system");
    expect(historyCategory({ kind: "history", body: "Updated", importedFromAct: true, actSourceType: "history" })).toBe("system");
    expect(historyCategory({ kind: "history", body: "   ", importedFromAct: true, actSourceType: "history" })).toBe("system");
  });

  it("converts imported HTML note bodies to readable text", () => {
    const html = '<div dir="auto"><p><span>Hi Breck Create,</span></p><p>We\'d love to come to Breckenridge&#39;s Pride Festival.</p><p><strong>America&#39;s Best Inflatable Carnival!</strong></p></div>';
    expect(htmlToPlainText(html)).toBe("Hi Breck Create,\nWe'd love to come to Breckenridge's Pride Festival.\nAmerica's Best Inflatable Carnival!");
    expect(simplifyHistoryText(html)).not.toContain("<span");
  });
});
