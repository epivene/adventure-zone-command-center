import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildProfileSearchTerms,
  profileSearchMatches,
  profileSearchTermMatches,
} from "./profile-search";

const routeSource = readFileSync("src/routes/organization-forgiving-search.ts", "utf8");
const indexSource = readFileSync("src/routes/index.ts", "utf8");

describe("forgiving profile search", () => {
  it("normalizes capitalization, punctuation, and whitespace into useful terms", () => {
    expect(buildProfileSearchTerms("  St. Mary's  ")).toEqual(["st", "marys"]);
    expect(buildProfileSearchTerms("DOWNTOWN,   Denver!!!")).toEqual(["downtown", "denver"]);
  });

  it("keeps partial email and phone searches useful", () => {
    expect(buildProfileSearchTerms("amy@gm")).toEqual(["amy", "gm"]);
    expect(buildProfileSearchTerms("(720) 272-7467")).toEqual(["720", "272", "7467"]);
    expect(buildProfileSearchTerms("720272")).toEqual(["720272"]);
  });

  it("matches close misspellings without making short searches fuzzy", () => {
    expect(profileSearchTermMatches("denvr", "Denver")).toBe(true);
    expect(profileSearchTermMatches("adventure", "Adventur")).toBe(true);
    expect(profileSearchTermMatches("co", "Colorado")).toBe(true);
    expect(profileSearchTermMatches("ca", "co")).toBe(false);
    expect(profileSearchMatches(["denvr", "festval"], ["Denver", "Mountain Festival"])).toBe(true);
  });

  it("matches every normalized term across profile, contact, and location fields", () => {
    expect(routeSource).toContain("buildProfileSearchTerms(query.search)");
    expect(routeSource).toContain("regexp_replace(lower(coalesce");
    expect(routeSource).toContain("o.name");
    expect(routeSource).toContain("o.region");
    expect(routeSource).toContain("o.website");
    expect(routeSource).toContain("person.email");
    expect(routeSource).toContain("loc.email");
    expect(routeSource).toContain("loc_contact.email");
    expect(routeSource).toContain("termConditions");
    expect(routeSource).toContain("sql.join(termConditions, sql.raw(\" and \"))");
  });

  it("keeps the forgiving search on the normal Profiles endpoint and ahead of the legacy route", () => {
    expect(routeSource).toContain('router.get("/organizations"');
    expect(routeSource).toContain("if (!query.search) return next();");
    expect(indexSource).toContain('import organizationForgivingSearchRouter from "./organization-forgiving-search"');
    expect(indexSource.indexOf("router.use(organizationForgivingSearchRouter)")).toBeLessThan(
      indexSource.indexOf("router.use(organizationsRouter)"),
    );
  });
});
