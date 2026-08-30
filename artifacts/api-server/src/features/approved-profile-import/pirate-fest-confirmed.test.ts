import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const fixturePath = fileURLToPath(
  new URL(
    "../../../../../imports/approved-profiles/pirate-fest-northglenn-co-2026.json",
    import.meta.url,
  ),
);
const payload = JSON.parse(readFileSync(fixturePath, "utf8"));

describe("Pirate Fest reviewed relationship state", () => {
  it("records the signed current contract as confirmed", () => {
    expect(payload.booking.status).toBe("confirmed");
    expect(payload.booking.nextActionKind).toBe("renewal");
  });

  it("retains one next-year renewal instead of stale current contract work", () => {
    expect(payload.followUps).toHaveLength(1);
    expect(payload.followUps[0].dueAt).toMatch(/^2027-/);
    expect(
      `${payload.followUps[0].label} ${payload.followUps[0].reason}`.toLowerCase(),
    ).toContain("2027");
  });

  it("removes the superseded non-booking story", () => {
    const text = JSON.stringify(payload).toLowerCase();
    expect(text).toContain("signed");
    expect(text).toContain("confirmed");
    expect(text).not.toMatch(
      /budget cuts|will not use adventure zone|passed because/,
    );
  });
});
