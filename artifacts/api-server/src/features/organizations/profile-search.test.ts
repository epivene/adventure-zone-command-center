import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildProfileSearchTerms } from "./profile-search";

const repositorySource = readFileSync("src/features/organizations/organization-repository.ts", "utf8");

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

  it("requires every search term while allowing each term to match any searchable profile field", () => {
    expect(repositorySource).toContain("buildProfileSearchTerms(query.search)");
    expect(repositorySource).toContain("searchTerms.map((term)");
    expect(repositorySource).toContain("and(...termConditions)");
    expect(repositorySource).toContain("normalizedSearchField");
    expect(repositorySource).toContain("person.email");
    expect(repositorySource).toContain("loc.email");
    expect(repositorySource).toContain("organizations.website");
    expect(repositorySource).toContain("organizations.region");
  });
});
