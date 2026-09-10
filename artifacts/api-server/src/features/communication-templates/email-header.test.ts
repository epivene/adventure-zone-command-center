import { expect, it } from "vitest";
import { conventionCampaignTemplates } from "./convention-campaign-template-seed";
import { updateConventionHeader } from "./email-header";

it("updates all seven headers once and keeps each headline, message, and links", () => {
  expect(conventionCampaignTemplates).toHaveLength(7);
  for (const template of conventionCampaignTemplates) {
    const html = template.bodyTemplate;
    expect(html.match(/data-convention-header="v3"/g)).toHaveLength(1);
    const label = template.code.startsWith("convention_during_") ? "WE’RE HERE! LET’S CONNECT!" : template.code.startsWith("convention_after_") ? "LET’S KEEP THE MOMENTUM GOING!" : "IT’S CONVENTION SEASON!";
    expect(html).toContain(label);
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


it("merges the shipped v1 header and headline into one cell without changing the headline or links", () => {
  const image = '<img src="https://adventure-zone-command-center-1.onrender.com/assets/adventure-zone-logo-tagline-20260910.png">';
  const tail = '<div class="hero-title">LET’S PLAN<br>SOMETHING BIG.</div><a href="https://example.com">Keep this link</a></td></tr>';
  const old = `<tr data-convention-header="v1"><td><table><tr><td>${image}</td><td>IT’S CONVENTION SEASON!</td></tr></table></td></tr><tr><td>${tail}`;
  const updated = updateConventionHeader(old);
  expect(updated).toContain('data-convention-header="v3"');
  expect(updated.match(/<td\b/g)).toHaveLength(1);
  expect(updated).toContain('margin:0 0 -76px auto');
  expect(updated.endsWith(tail)).toBe(true);
  expect(updateConventionHeader(updated)).toBe(updated);
});



it("changes only the label when upgrading an existing v2 header", () => {
  const before = conventionCampaignTemplates[0].bodyTemplate.replace('data-convention-header="v3"', 'data-convention-header="v2"');
  for (const [code, label] of [["convention_during_new_v2", "WE’RE HERE! LET’S CONNECT!"], ["convention_after_new_v2", "LET’S KEEP THE MOMENTUM GOING!"]]) {
    expect(updateConventionHeader(before, code)).toBe(before.replace('data-convention-header="v2"', 'data-convention-header="v3"').replace("IT’S CONVENTION SEASON!", label));
  }
});
