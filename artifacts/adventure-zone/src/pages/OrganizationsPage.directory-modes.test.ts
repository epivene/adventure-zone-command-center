import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/OrganizationsPage.tsx", "utf8");

describe("Profiles directory modes", () => {
  it("keeps All Events Organizations and Contacts inside Profiles", () => {
    expect(source).toContain('["all", "events", "organizations", "contacts"]');
    expect(source).toContain('item === "all" ? "All"');
    expect(source).toContain('item === "events" ? "Events"');
    expect(source).toContain('item === "organizations" ? "Organizations"');
    expect(source).toContain('params.get("view")');
  });

  it("renders contacts inside Profiles instead of linking to a separate directory", () => {
    expect(source).toContain("<ContactDirectoryView");
    expect(source).toContain('basePath="/profiles"');
    expect(source).toContain('fixedParams={{ view: "contacts" }}');
  });

  it("uses composed existing API pages for broad Events and Organizations buckets", () => {
    expect(source).toContain("loadProfileDirectoryBucket");
    expect(source).toContain('view === "events" || view === "organizations"');
  });
});
