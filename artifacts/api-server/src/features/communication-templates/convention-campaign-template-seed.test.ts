import { describe, expect, it } from "vitest";
import { conventionCampaignTemplates } from "./convention-campaign-template-seed";

describe("convention campaign template seed", () => {
  it("preserves all seven finalized Gmail convention drafts as distinct templates", () => {
    expect(conventionCampaignTemplates).toHaveLength(7);
    expect(conventionCampaignTemplates.map((item) => ({
      code: item.code,
      gmailMessageId: item.gmailMessageId,
      name: item.name,
    }))).toEqual([
      {
        code: "convention_before_general_v2",
        gmailMessageId: "1a0847e159516da1",
        name: "TEMPLATE 1 — BEFORE Convention — General (New or Past Event)",
      },
      {
        code: "convention_before_new_event_v2",
        gmailMessageId: "1a084a2f40feb499",
        name: "TEMPLATE 2 — BEFORE Convention — New Event",
      },
      {
        code: "convention_before_past_event_v2",
        gmailMessageId: "1a084a30b8f72f15",
        name: "TEMPLATE 3 — BEFORE Convention — Past Event",
      },
      {
        code: "convention_during_new_event_v2",
        gmailMessageId: "1a084a31eb26862c",
        name: "TEMPLATE 4 — DURING Convention — New Event",
      },
      {
        code: "convention_during_past_event_v2",
        gmailMessageId: "1a084a3353ce3f92",
        name: "TEMPLATE 5 — DURING Convention — Past Event",
      },
      {
        code: "convention_after_new_event_v2",
        gmailMessageId: "1a084a3877bde871",
        name: "TEMPLATE 6 — AFTER Convention — New Event",
      },
      {
        code: "convention_after_past_event_v2",
        gmailMessageId: "1a084a39fdd1790d",
        name: "TEMPLATE 7 — AFTER Convention — Past Event",
      },
    ]);
  });

  it("keeps the finalized Gmail design and the agreed Early Bird addition", () => {
    const expectedHeadlines = [
      "LET’S PLAN",
      "LET’S CREATE",
      "LET’S MAKE",
      "LET’S TALK",
      "COME CATCH UP",
      "THE FUN GOING",
      "WHAT’S NEXT",
    ];

    for (const [index, template] of conventionCampaignTemplates.entries()) {
      expect(template.bodyTemplate).toContain(expectedHeadlines[index]);
      expect(template.bodyTemplate).toContain("#0f1729");
      expect(template.bodyTemplate).toContain("#ff0a8a");
      expect(template.bodyTemplate).toContain("25+");
      expect(template.bodyTemplate).toContain("500+");
      expect(template.bodyTemplate).toContain("PIRATE’S");
      expect(template.bodyTemplate).toContain("WARRIOR’S");
      expect(template.bodyTemplate.match(/Early Bird/g)).toHaveLength(1);
      expect(template.bodyTemplate).not.toMatch(/winter booking promo/i);
      expect(template.bodyTemplate).not.toMatch(/30 days from (this|your) email/i);
    }
  });
});
