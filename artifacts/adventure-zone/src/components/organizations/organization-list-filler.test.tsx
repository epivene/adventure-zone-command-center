// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const listSource = readFileSync(new URL("./organization-list.tsx", import.meta.url), "utf8");
const pageSource = readFileSync(new URL("../../pages/OrganizationsPage.tsx", import.meta.url), "utf8");
const menuSource = readFileSync(new URL("../profiles/profile-actions-menu.tsx", import.meta.url), "utf8");
const fillerActionSource = readFileSync(new URL("../profiles/profile-filler-action.tsx", import.meta.url), "utf8");

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
