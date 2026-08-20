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
});
