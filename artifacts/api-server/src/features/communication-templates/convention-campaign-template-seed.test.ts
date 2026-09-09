import { describe, expect, it } from "vitest";
import { conventionCampaignTemplates } from "./convention-campaign-template-seed";

describe("convention campaign template seed", () => {
  it("contains one approved-design HTML template for every convention stage", () => {
    expect(conventionCampaignTemplates).toHaveLength(3);
    expect(conventionCampaignTemplates.map((item) => item.code)).toEqual([
      "convention_pre_event_v1", "convention_during_event_v1", "convention_post_event_v1",
    ]);
    for (const template of conventionCampaignTemplates) {
      expect(template.bodyTemplate).toContain("https://");
      expect(template.bodyTemplate).toContain('alt="Adventure Zone');
      expect(template.bodyTemplate).toContain("#ef1763");
      expect(template.bodyTemplate).toContain("{{personalNote}}");
      expect(template.bodyTemplate.match(/Early Bird/g)).toHaveLength(1);
      expect(template.bodyTemplate).not.toMatch(/winter booking promo/i);
      expect(template.bodyTemplate).not.toMatch(/30 days from (this|your) email/i);
      expect(template.bodyTemplate.match(/The Adventure Zone<\/strong>/g)).toHaveLength(1);
    }
    expect(conventionCampaignTemplates[1].bodyTemplate).toContain("Slide into action!");
  });
});
