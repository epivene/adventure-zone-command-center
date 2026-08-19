import { describe, expect, it } from "vitest";

import { selectActivitiesForDerivedFactExtraction } from "./derived-fact-job";

type Row = {
  id: string;
  body: string;
  occurred_at: string;
  source_record_id: string | null;
  source_version_id: string | null;
};

function row(id: string, body: string, day: number): Row {
  return {
    id,
    body,
    occurred_at: `2025-07-${String(day).padStart(2, "0")}T12:00:00.000Z`,
    source_record_id: `record-${id}`,
    source_version_id: `version-${id}`,
  };
}

describe("selectActivitiesForDerivedFactExtraction", () => {
  it("keeps older pricing and operational notes even when newer generic history fills the normal limit", () => {
    const generic = Array.from({ length: 45 }, (_, index) =>
      row(`generic-${index}`, `Called customer and left a message ${index}.`, 28 - (index % 20)),
    );
    const olderPrice = row(
      "price",
      "2024 event: quoted $7,500 for Adventure Zone plus paintball; customer approved the amount.",
      1,
    );
    const olderSetup = row(
      "setup",
      "Site requires a forklift for load-out and 220V power. Setup access begins two days early.",
      2,
    );

    const selected = selectActivitiesForDerivedFactExtraction(
      [...generic, olderPrice, olderSetup],
      40,
    );

    expect(selected).toHaveLength(40);
    expect(selected.map((activity) => activity.id)).toContain("price");
    expect(selected.map((activity) => activity.id)).toContain("setup");
  });

  it("does not treat every dollar sign as a package price when the note is clearly unrelated", () => {
    const unrelated = row("unrelated", "Bought $25 of office supplies before calling the fair.", 20);
    const packagePrice = row("package-price", "Quoted $6,000 for Pirate's Rebellion for the 2024 event.", 1);

    const selected = selectActivitiesForDerivedFactExtraction([unrelated, packagePrice], 1);

    expect(selected[0]?.id).toBe("package-price");
  });
});
