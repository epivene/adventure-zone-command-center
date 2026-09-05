import { describe, expect, it } from "vitest";
import { classify } from "./coi-certificates";

describe("COI expiration classification", () => {
  it("distinguishes missing files and dates from usable certificates", () => {
    expect(classify(null, "asset", "2026-09-05")).toBe("incomplete");
    expect(classify("2026-09-20", null, "2026-09-05")).toBe("incomplete");
    expect(classify("2026-09-06", "asset", "2026-09-05")).toBe("expiring_soon");
  });

  it("uses inclusive thirty-day and expiry boundaries", () => {
    expect(classify("2026-09-05", "asset", "2026-09-05")).toBe("expiring_soon");
    expect(classify("2026-10-05", "asset", "2026-09-05")).toBe("expiring_soon");
    expect(classify("2026-10-06", "asset", "2026-09-05")).toBe("current");
    expect(classify("2026-09-04", "asset", "2026-09-05")).toBe("expired");
  });
});