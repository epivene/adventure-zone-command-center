import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");

describe("Profiles directory modes", () => {
  it("keeps Profiles and Contacts as the only directory modes", () => {
    expect(source).toContain('["profiles", "contacts"]');
    expect(source).toContain('item === "profiles" ? "Profiles" : "Contacts"');
    expect(source).toContain('params.get("view")');
    expect(source).not.toContain('"events"');
    expect(source).not.toContain('"organizations"');
  });

  it("renders contacts inside Profiles instead of linking to a separate directory", () => {
    expect(source).toContain("<ContactDirectoryView");
    expect(source).toContain('basePath="/profiles"');
    expect(source).toContain('fixedParams={{ view: "contacts" }}');
  });

  it("uses the normal profile type filter instead of separate event and organization buckets", () => {
    expect(source).not.toContain("loadProfileDirectoryBucket");
    expect(source).toContain("<OrganizationList");
  });
});
