import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/EventProfilePage.tsx", "utf8");
const simple = readFileSync("src/components/profiles/simple-full-profile.tsx", "utf8");

describe("simple full profile", () => {
  it("uses the simple profile surface before advanced tools", () => {
    expect(page).toContain("<SimpleFullProfile profile={data} />");
    expect(page).toContain("Advanced profile tools");
    expect(page.indexOf("<SimpleFullProfile profile={data} />")).toBeLessThan(page.indexOf("Advanced profile tools"));
  });

  it("keeps Overview Notes Events as the main full-profile sections", () => {
    expect(simple).toContain('["overview", "notes", "events"]');
    expect(simple).toContain("What matters next");
    expect(simple).toContain("Notes & communication");
    expect(simple).toContain("All contacts");
  });

  it("keeps secondary data collapsed by default", () => {
    expect(page).toContain("Reviews & rating");
    expect(page).toContain("Imported ACT history");
    expect(page).toContain("<details");
  });
});
