import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/pages/CalendarPage.tsx", "utf8");

describe("calendar default booking visibility", () => {
  it("shows confirmed bookings by default and keeps potential bookings opt-in", () => {
    expect(source).toContain('const [showPotential, setShowPotential] = useState(false)');
    expect(source).toContain('String((event as any).status ?? "").toLowerCase() === "confirmed"');
    expect(source).toContain("Show potential (");
    expect(source).toContain("Hide potential");
  });

  it("keeps imported ACT activity available to the calendar's own hidden control", () => {
    expect(source).toContain("isActActivity(event) ||");
  });
});
