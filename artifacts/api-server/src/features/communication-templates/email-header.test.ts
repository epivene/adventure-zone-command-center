import { expect, it } from "vitest";
import { conventionCampaignTemplates } from "./convention-campaign-template-seed";
import { updateConventionHeader } from "./email-header";

it("updates all seven headers once and keeps each headline, message, and links", () => {
  expect(conventionCampaignTemplates).toHaveLength(7);
  for (const template of conventionCampaignTemplates) {
    const html = template.bodyTemplate;
    expect(html.match(/data-convention-header="v1"/g)).toHaveLength(1);
    expect(html.match(/IT’S CONVENTION SEASON!/g)).toHaveLength(1);
    expect(html).toContain("transform:rotate(10deg)");
    expect(html).toContain("height:auto");
    expect(html).toContain("max-width:480px");
    expect(html).toContain("hero-title");
    expect(html).toContain("{{conventionName}}");
    expect(updateConventionHeader(html)).toBe(html);
  }
});

it("leaves unrelated templates untouched", () => {
  const html = '<p>My own email</p><img src="custom.png">';
  expect(updateConventionHeader(html)).toBe(html);
});
