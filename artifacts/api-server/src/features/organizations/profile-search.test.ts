import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  buildProfileSearchTerms,
  profileSearchMatches,
  profileSearchTermMatches,
} from "./profile-search";
import * as profileSearch from "./profile-search";

const routeSource = readFileSync("src/routes/organization-forgiving-search.ts", "utf8");
const indexSource = readFileSync("src/routes/index.ts", "utf8");
const organizationRepositorySource = readFileSync("src/features/organizations/organization-repository.ts", "utf8");

describe("forgiving profile search", () => {
  it("normalizes capitalization, punctuation, and whitespace into useful terms", () => {
    expect(buildProfileSearchTerms("  St. Mary's  ")).toEqual(["st", "marys"]);
    expect(buildProfileSearchTerms("DOWNTOWN,   Denver!!!")).toEqual(["downtown", "denver"]);
  });

  it("keeps partial email and phone searches useful", () => {
    expect(buildProfileSearchTerms("amy@gm")).toEqual(["amy", "gm"]);
    expect(buildProfileSearchTerms("(720) 272-7467")).toEqual(["720", "272", "7467"]);
    expect(buildProfileSearchTerms("720272")).toEqual(["720272"]);
    expect(profileSearchTermMatches("7202727467", "(720) 272-7467")).toBe(true);
  });

  it("finds Wyoming when the user types wryomin", () => {
    expect(profileSearchTermMatches("wryomin", "Wyoming")).toBe(true);
  });

  it("matches a misspelled contact name to the profile that contains that contact", () => {
    expect(profileSearchMatches(["jonsen"], ["Rock Springs Fair", "Mary Johnson", "Wyoming"])).toBe(true);
  });

  it("keeps short searches strict", () => {
    expect(profileSearchTermMatches("denvr", "Denver")).toBe(true);
    expect(profileSearchTermMatches("adventure", "Adventur")).toBe(true);
    expect(profileSearchTermMatches("co", "Colorado")).toBe(true);
    expect(profileSearchTermMatches("ca", "co")).toBe(false);
    expect(profileSearchMatches(["denvr", "festval"], ["Denver", "Mountain Festival"])).toBe(true);
  });

  it("ranks exact matches ahead of close spelling suggestions", () => {
    const score = (profileSearch as Record<string, unknown>).profileSearchScore as
      | ((terms: string[], values: string[]) => number | null)
      | undefined;
    expect(score?.(["wyoming"], ["Wyoming County Fair"])).toBeLessThan(
      score?.(["wyoming"], ["Wryomin County Fair"]) ?? Number.POSITIVE_INFINITY,
    );
  });

  it("matches every normalized term across profile, contact, and location fields", () => {
    expect(routeSource).toContain("buildProfileSearchTerms(query.search)");
    expect(routeSource).toContain("profileSearchScore(terms");
    expect(routeSource).toContain("loadOrganizationSearchCorpus");
  });

  it("builds the corpus from the same eligible profiles returned by the repository", () => {
    const handlerSource = routeSource.slice(routeSource.indexOf('router.get("/organizations"'));
    expect(handlerSource.indexOf("const candidatePage")).toBeLessThan(
      handlerSource.indexOf("const matchedIds"),
    );
    expect(handlerSource).toContain("candidatePage.records.map((record) => record.id)");
  });

  it("keeps forgiving profile search on the normal Profiles endpoint", () => {
    expect(routeSource).toContain('router.get("/organizations"');
    expect(routeSource).toContain("if (!query.search) return next();");
    expect(indexSource).toContain('import organizationForgivingSearchRouter from "./organization-forgiving-search"');
    expect(indexSource.indexOf("router.use(organizationForgivingSearchRouter)")).toBeLessThan(
      indexSource.indexOf("router.use(organizationsRouter)"),
    );
  });

  it("preserves latest recorded event dates in the forgiving-search result path", () => {
    expect(routeSource).toContain("new DrizzleOrganizationRepository(db).listOrganizations");
    expect(organizationRepositorySource).toContain(".from(festivalEditions)");
    expect(organizationRepositorySource).toContain(
      "latestRecordedEventDate: resolveMostRecentRecordedEventDate",
    );
  });
});
