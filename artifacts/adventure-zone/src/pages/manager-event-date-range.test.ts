import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const home = fs.readFileSync(path.resolve(__dirname, "ManagerHomePage.tsx"), "utf8");
const route = fs.readFileSync(path.resolve(__dirname, "ManagerRoutePage.tsx"), "utf8");

describe("leg manager event date ranges", () => {
  it("shows full event spans on manager Home and Schedule surfaces", () => {
    expect(home).toContain("formatEventRange");
    expect(home).toContain("nextEvent.endsAt");
    expect(route).toContain("formatEventRange");
    expect(route).toContain("event.endsAt");
    expect(route).toContain("detailEvent.endsAt");
  });
});
