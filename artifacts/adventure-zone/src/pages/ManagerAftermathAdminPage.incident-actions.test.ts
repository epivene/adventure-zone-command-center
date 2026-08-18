import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const page = readFileSync("src/pages/ManagerAftermathAdminPage.tsx", "utf8");

describe("admin incident controls", () => {
  it("offers edit and delete actions for incidents", () => {
    expect(page).toContain("Edit incident");
    expect(page).toContain("Delete incident");
    expect(page).toContain("Save changes");
  });

  it("confirms destructive incident deletion", () => {
    expect(page).toContain("Delete this incident?");
  });
});
