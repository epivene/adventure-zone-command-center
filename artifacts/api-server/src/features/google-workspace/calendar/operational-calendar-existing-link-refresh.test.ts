import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/google-workspace/calendar/operational-calendar-import-service.ts", "utf8");

describe("operational calendar existing-link refresh", () => {
  it("refreshes an already-linked booking instead of returning before the booking/window update", () => {
    expect(source).toContain("await this.refreshExistingLink({");
    expect(source).toContain("existingLink,");
    expect(source).toContain("reservedStart,");
    expect(source).toContain("reservedEnd,");
  });
});
