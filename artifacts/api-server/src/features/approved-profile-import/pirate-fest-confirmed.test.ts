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
  it("records 2026 as declined rather than a signed booking", () => {
    expect(payload.event.id).toBe("f24033e1-801b-43ff-9a7e-a9d6d7b426c3");
    expect(payload.booking.status).toBe("declined");
    expect(payload.booking.nextActionKind).toBe("renewal");
  });

  it("retains one future-year renewal instead of current-year contract work", () => {
    expect(payload.followUps).toHaveLength(1);
    expect(payload.followUps[0].dueAt).toMatch(/^2027-/);
    expect(
      `${payload.followUps[0].label} ${payload.followUps[0].reason}`.toLowerCase(),
    ).toContain("2027");
  });

  it("preserves the newest 2026 no and the organizer's future interest", () => {
    const text = JSON.stringify(payload).toLowerCase();
    expect(text).toMatch(/not moving forward|not participating|will not use adventure zone|declined/);
    expect(text).toContain("2027");
    expect(text).not.toMatch(/signed contract|contract has been signed|booking is confirmed/);
  });
});
