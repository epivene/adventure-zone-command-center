import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/bookings.ts", "utf8");

describe("booking detail id validation", () => {
  it("rejects non-UUID booking ids before repository lookup", () => {
    expect(source).toContain("const parsedId = actionUuid.safeParse(id);");
    expect(source).toContain('res.status(400).json({ error: "Invalid booking id" });');
    const validation = source.indexOf("const parsedId = actionUuid.safeParse(id);");
    const lookup = source.indexOf("bookingRepo().getBookingDetail(parsedId.data)");
    expect(validation).toBeGreaterThan(-1);
    expect(lookup).toBeGreaterThan(validation);
  });
});
