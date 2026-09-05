import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";

describe("contract signature UI boundary", () => {
  it("shows readiness, ordered recipients, provider refresh, and provider files", async () => {
    const source = await readFile(new URL("./ContractSignaturePanel.tsx", import.meta.url), "utf8");
    expect(source).toContain("signs first");
    expect(source).toContain("countersigns second");
    expect(source).toContain("Refresh from Adobe");
    expect(source).toContain("Signed PDF");
    expect(source).toContain("Audit trail");
    expect(source).toContain("Acrobat Pro alone does not enable the Sign API");
  });
});