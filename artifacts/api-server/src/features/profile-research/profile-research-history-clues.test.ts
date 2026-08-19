import { describe, expect, it } from "vitest";

import { extractProfileHistoryIdentityClues } from "./profile-research-history-clues";

function profile(notes: string[]) {
  return {
    notes: notes.map((body, index) => ({ id: String(index), body })),
  } as any;
}

describe("extractProfileHistoryIdentityClues", () => {
  it("extracts a named organizer and venue without forwarding the surrounding note", () => {
    const clues = extractProfileHistoryIdentityClues(profile([
      "Called again about pricing. Spoke with Melissa Anderson and she said the board budget is private. Venue: Riverfront Park. Follow up next month.",
    ]));

    expect(clues).toContain("Melissa Anderson");
    expect(clues).toContain("Riverfront Park");
    expect(clues.join(" ")).not.toContain("pricing");
    expect(clues.join(" ")).not.toContain("private");
    expect(clues.join(" ")).not.toContain("budget");
  });

  it("strips URLs, emails, and phone numbers before extracting clues", () => {
    const clues = extractProfileHistoryIdentityClues(profile([
      "Spoke with Jane Smith jane@example.com 701-555-1212 https://private.example about the event.",
    ]));
    expect(clues).toContain("Jane Smith");
    expect(clues.join(" ")).not.toContain("example.com");
    expect(clues.join(" ")).not.toContain("555");
  });

  it("does not forward ordinary narrative history as a search clue", () => {
    const clues = extractProfileHistoryIdentityClues(profile([
      "They were unhappy with the previous price and asked us not to call until the committee makes a decision.",
    ]));
    expect(clues).toEqual([]);
  });
});
