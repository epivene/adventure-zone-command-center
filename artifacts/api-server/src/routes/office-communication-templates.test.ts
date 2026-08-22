import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const route = readFileSync(path.resolve(process.cwd(), "src/routes/office-communication-templates.ts"), "utf8");
const editor = readFileSync(path.resolve(process.cwd(), "../adventure-zone/src/components/office/office-email-editor.tsx"), "utf8");

describe("Office communication template commercial boundaries", () => {
  it("does not expose commercial rule records or conflicts", () => {
    for (const forbidden of [
      "commercialOffers",
      "sourceConflictNote",
      "Good Deal",
      "Great Deal",
      "Make It Right",
      "convention_12_percent",
      "repeat_customer_500",
    ]) {
      expect(route).not.toContain(forbidden);
      expect(editor).not.toContain(forbidden);
    }
  });

  it("rejects undeclared commercial-offer input because the Office render body is strict", () => {
    expect(route).toContain(".strict()");
    expect(route).not.toContain("commercialOfferId");
  });
});
