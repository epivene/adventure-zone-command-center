import { describe, expect, it } from "vitest";

import { COMMUNICATION_TEMPLATE_SEEDS } from "./communication-template-seed";
import {
  CURRENT_SYSTEM_SOURCE_NOTE,
  PREVIOUS_SYSTEM_SOURCE_NOTE,
} from "./communication-template-repository";

const byCode = new Map(COMMUNICATION_TEMPLATE_SEEDS.map((template) => [template.code, template]));

describe("source-grounded communication template refresh", () => {
  it("restores the recognizable Sticky Notes / Amy outreach opening", () => {
    const intro = byCode.get("new_event_intro");
    expect(intro?.bodyTemplate).toContain("My name is {{senderName}}, and I work with Dave");
    expect(intro?.bodyTemplate).toContain("America’s Best Inflatable Carnival");
    expect(intro?.bodyTemplate).toContain("We’d love to come to your {{eventName}}");
    expect(intro?.bodyTemplate).toContain("{{packagePrice}}");
    expect(intro?.bodyTemplate).toContain("{{packageDuration}}");
    expect(intro?.bodyTemplate).not.toContain("$9,000");
  });

  it("includes source-supported forward, insurance, state-fair, and decline replies", () => {
    expect(byCode.get("wrong_person_forward")?.bodyTemplate).toMatch(/forward.*right person/is);
    expect(byCode.get("insurance_liability_response")?.bodyTemplate).toMatch(/additional(?:ly)? insured/i);
    expect(byCode.get("state_fair_email")?.bodyTemplate).toMatch(/set.?up.*tear.?down/is);
    expect(byCode.get("not_this_year_thank_you")?.bodyTemplate).toMatch(/keep us in mind/i);
  });

  it("keeps sensitive or changing business terms out of reusable Office promises", () => {
    const officeCopy = COMMUNICATION_TEMPLATE_SEEDS
      .filter((template) => template.accessScope === "office")
      .map((template) => `${template.subjectTemplate ?? ""}\n${template.bodyTemplate}`)
      .join("\n");
    expect(officeCopy).not.toContain("12% Convention Discount");
    expect(officeCopy).not.toContain("10% Early Bird");
    expect(officeCopy).not.toContain("$2,000,000");
    expect(officeCopy).not.toContain("$2M");
  });

  it("tracks a deliberate seed provenance revision", () => {
    expect(PREVIOUS_SYSTEM_SOURCE_NOTE).not.toBe(CURRENT_SYSTEM_SOURCE_NOTE);
    expect(CURRENT_SYSTEM_SOURCE_NOTE).toContain("Adventure Zone Sticky Notes");
    expect(CURRENT_SYSTEM_SOURCE_NOTE).toContain("Amy");
  });
});
