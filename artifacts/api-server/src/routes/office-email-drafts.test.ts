import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const sourcePath = path.resolve(process.cwd(), "src/routes/office-email-drafts.ts");

describe("Office email draft route boundary", () => {
  it("contains draft and submit routes but no Office send route", () => {
    const source = readFileSync(sourcePath, "utf8");
    expect(source).toContain('/office/email-drafts');
    expect(source).toContain('/submit');
    expect(source).not.toMatch(/office\/email-drafts[^\n]*\/send/);
    expect(source).not.toContain('MailDelivery');
  });
});
