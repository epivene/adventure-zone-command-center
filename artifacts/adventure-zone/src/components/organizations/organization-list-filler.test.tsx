// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function readSource(relativePath: string) {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

const listSource = readSource("artifacts/adventure-zone/src/components/organizations/organization-list.tsx");
const pageSource = readSource("artifacts/adventure-zone/src/pages/OrganizationsPage.tsx");
const menuSource = readSource("artifacts/adventure-zone/src/components/profiles/profile-actions-menu.tsx");
const fillerActionSource = readSource("artifacts/adventure-zone/src/components/profiles/profile-filler-action.tsx");

describe("Filler profile UI", () => {
  it("shows Filler as a secondary profile badge and directory filter", () => {
    expect(listSource).toContain('organization.filler ?');
    expect(listSource).toContain('>Filler<');
    expect(listSource).toContain('name="filler"');
    expect(pageSource).toContain('params.get("filler")');
  });

  it("lets the profile action menu mark or remove Filler", () => {
    expect(menuSource).toContain("ProfileFillerDialog");
    expect(menuSource).toContain('"Mark Filler"');
    expect(menuSource).toContain('"Remove Filler"');
    expect(fillerActionSource).toContain("Filler reason");
    expect(fillerActionSource).toContain("route gap");
    expect(fillerActionSource).toContain("open weekend");
    expect(fillerActionSource).toContain("between bookings");
  });
});
