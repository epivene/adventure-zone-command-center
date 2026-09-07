import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/index.ts", "utf8");
describe("Google document worker wiring", () => {
  it("starts and closes the hourly document loop", () => {
    expect(source).toContain("googleDocumentLoop.start();");
    expect(source).toContain("googleDocumentLoop.close(),");
  });
});
