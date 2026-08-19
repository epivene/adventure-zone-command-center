import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const source = fs.readFileSync(path.resolve(__dirname, "needs-attention.tsx"), "utf8");

describe("Needs Attention semantics", () => {
  it("keeps queue work out of the exception list", () => {
    expect(source).not.toContain('label: "Follow-ups due"');
    expect(source).not.toContain('label: "New leads"');
    expect(source).toContain('label: "Contracts needing attention"');
    expect(source).toContain('label: "Route issues"');
  });
});
