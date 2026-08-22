import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/office/office-email-editor.tsx", "utf8");

describe("OfficeEmailEditor template select syntax", () => {
  it("closes the JSX expression after the template change handler", () => {
    expect(source).toContain('setPackageTemplateId(packages.find((pkg)=>pkg.code==="mini_zone")?.id??"")}}}>');
  });
});
