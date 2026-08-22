import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/leg-manager-event-checklists.ts", "utf8");

describe("Leg Manager event checklist routes", () => {
  it("exposes resumable pre/post checklist endpoints", () => {
    for (const route of [
      "/manager/events/:bookingId/checklists/:phase",
      "/manager/events/:bookingId/checklists/:phase/start",
      "/manager/events/:bookingId/checklist-results/:resultId",
      "/manager/events/:bookingId/checklists/:phase/complete",
      "/manager/events/:bookingId/checklists/:phase/unable-to-complete",
    ]) {
      expect(source).toContain(route);
    }
  });

  it("requires manager auth and never exposes an Office route", () => {
    expect(source).toContain("requireManager");
    expect(source).not.toContain("/office/");
  });
});
