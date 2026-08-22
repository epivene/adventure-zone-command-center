import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const seed = readFileSync(
  path.resolve(process.cwd(), "src/features/commercial-offers/commercial-offer-seed.ts"),
  "utf8",
);
const officeRoute = readFileSync(
  path.resolve(process.cwd(), "src/routes/office-communication-templates.ts"),
  "utf8",
);
const callScripts = readFileSync(
  path.resolve(process.cwd(), "../adventure-zone/src/features/calls/guided-call-scripts.ts"),
  "utf8",
);

describe("commercial offer source safety", () => {
  it("contains no Active source seed", () => {
    expect(seed).not.toMatch(/state:\s*["']active["']/);
  });

  it("keeps discretionary rule names out of Office APIs", () => {
    for (const value of ["Good Deal", "Great Deal", "Make It Right"]) {
      expect(officeRoute).not.toContain(value);
    }
  });

  it("keeps guided-call payment language conditional", () => {
    expect(callScripts).toContain("some events may qualify");
    expect(callScripts).toContain("I don't want to promise an option before I check the event details");
  });
});
