import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");

describe("Profiles directory modes", () => {
  it("keeps All Events Organizations and Contacts inside Profiles", () => {
    for (const label of ["All", "Events", "Organizations", "Contacts"]) {
      expect(source).toContain(`>${label}<`);
    }
    expect(source).toContain('params.get("view")');
  });

  it("renders contacts inside Profiles instead of linking to a separate directory", () => {
    expect(source).toContain("<ContactDirectoryView");
    expect(source).toContain('basePath="/profiles"');
    expect(source).toContain('fixedParams={{ view: "contacts" }}');
  });
});
