import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("invoice and contract workspace routes", () => {
  it("registers the workspace only for authorized roles", () => {
    const source = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    expect(source).toContain('path="/invoices-contracts"');
    expect(source).toContain('path="/office/invoices-contracts"');
    expect(source).toContain('path="/boss/invoices-contracts"');
    expect(source).not.toContain('path="/manager/invoices-contracts"');
  });
});
