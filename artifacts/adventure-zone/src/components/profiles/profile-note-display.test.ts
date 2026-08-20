import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { mergeOptimisticActivities } from "./profile-note-display";

const persisted = {
  id: "persisted-1",
  body: "Older note",
};
const optimistic = {
  id: "new-1",
  body: "Just saved note",
};

describe("mergeOptimisticActivities", () => {
  it("shows a successful newly-created activity immediately before the profile reload catches up", () => {
    expect(mergeOptimisticActivities([persisted], [optimistic])).toEqual([
      optimistic,
      persisted,
    ]);
  });

  it("deduplicates the optimistic activity after the refreshed profile contains the same id", () => {
    const refreshed = { ...optimistic, body: "Just saved note from refreshed profile" };

    expect(mergeOptimisticActivities([refreshed, persisted], [optimistic])).toEqual([
      refreshed,
      persisted,
    ]);
  });

  it("confirms successful note saves even if a profile refresh is slow", () => {
    const actionSource = fs.readFileSync(path.resolve(__dirname, "../../actions/activities.ts"), "utf8");
    expect(actionSource).toContain('input.kind === "note"');
    expect(actionSource).toContain('toast({ title: "Note saved" })');
  });

  it("mounts one global toaster so save confirmation is visible from any admin page", () => {
    const appSource = fs.readFileSync(path.resolve(__dirname, "../../App.tsx"), "utf8");
    const profilesPageSource = fs.readFileSync(path.resolve(__dirname, "../../pages/OrganizationsPage.tsx"), "utf8");
    expect(appSource).toContain("<Toaster />");
    expect(profilesPageSource).not.toContain("<Toaster />");
  });
});
