import { describe, expect, it } from "vitest";
import { assertTransition, canTransition, compareWorkRequestUrgency } from "./boss-work-request-state";

describe("Boss work-request state", () => {
  it("allows the two review paths and rejects reopening a terminal request", () => {
    expect(canTransition("waiting_on_dave", "submitted_to_owner")).toBe(true);
    expect(canTransition("waiting_on_dave", "approved")).toBe(true);
    expect(canTransition("waiting_on_dave", "changes_requested")).toBe(true);
    expect(canTransition("applied", "in_progress")).toBe(false);
    expect(() => assertTransition("cancelled", "waiting_on_dave")).toThrow(/Invalid/);
  });

  it("sorts urgent work before due date and age", () => {
    const now = new Date("2026-09-09T12:00:00Z");
    const later = new Date("2026-09-10T12:00:00Z");
    expect(compareWorkRequestUrgency(
      { priority: "urgent", dueAt: later, createdAt: later },
      { priority: "high", dueAt: now, createdAt: now },
    )).toBeLessThan(0);
  });
});
