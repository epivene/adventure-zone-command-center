import { describe, expect, it } from "vitest";
import { confirmationLabel } from "./crew-confirmation";

describe("staff confirmation age", () => {
  const now = new Date(2026, 9, 9, 12);
  it("shows actual calendar age for both yes and no", () => {
    expect(confirmationLabel("yes", "2026-10-09", now)).toBe("Staff confirmed 2026-10-09 · today");
    expect(confirmationLabel("no", "2026-10-08", now)).toBe("Staff confirmed 2026-10-08 · 1 day ago");
    expect(confirmationLabel("yes", "2026-09-30", now)).toBe("Staff confirmed 2026-09-30 · 9 days ago");
  });
  it("never substitutes lookup or update dates for missing confirmation", () => {
    for (const date of [null, undefined, "", "2026-02-30", "2026-10-09T00:00:00Z", "2026-10-10"]) {
      expect(confirmationLabel("yes", date, now)).toBe("Not confirmed by staff");
    }
    expect(confirmationLabel("unknown", "2026-10-01", now)).toBe("Not confirmed by staff");
  });
});
