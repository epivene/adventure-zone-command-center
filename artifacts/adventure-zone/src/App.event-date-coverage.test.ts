import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Event Date Coverage navigation", () => {
  it("links the Admin Tools card to the owner-protected coverage route", () => {
    const app = readFileSync(`${process.cwd()}/src/App.tsx`, "utf8");
    expect(app).toContain('["Event date coverage", "/settings/event-date-coverage"');
    expect(app).toContain('<Route path="/settings/event-date-coverage" component={EventDateCoveragePage} />');
    expect(app.indexOf('<Route path="/settings/event-date-coverage"')).toBeLessThan(app.indexOf('<Route path="/settings" component={SettingsStub} />'));
  });
});
