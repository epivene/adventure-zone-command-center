import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const researchPanel = fs.readFileSync(path.resolve(__dirname, "profile-research-panel.tsx"), "utf8");
const newPage = fs.readFileSync(path.resolve(__dirname, "../../pages/EventProfileNewPage.tsx"), "utf8");
const form = fs.readFileSync(path.resolve(__dirname, "../event-profiles/event-profile-form.tsx"), "utf8");

describe("Researcher Release 3 prospect intake", () => {
  it("offers Add as lead only for new prospects", () => {
    expect(researchPanel).toContain("Add as lead");
    expect(researchPanel).toContain('crmMatch?.status === "new_prospect"');
  });

  it("prefills the normal Add Event / Lead form from scout query parameters", () => {
    expect(newPage).toContain('params.get("sourceUrl")');
    expect(newPage).toContain('params.get("startsAt")');
    expect(newPage).toContain('params.get("endsAt")');
    expect(form).toContain("initialEventName");
    expect(form).toContain("initialWebsite");
    expect(form).toContain("initialStartsAt");
    expect(form).toContain("initialEndsAt");
  });

  it("keeps the normal follow-up choice before saving", () => {
    expect(form).toContain("Next follow-up date");
    expect(form).toContain("nextActionDueAt");
  });
});
