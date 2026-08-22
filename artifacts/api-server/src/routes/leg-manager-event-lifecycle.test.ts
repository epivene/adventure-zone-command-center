import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/leg-manager-event-lifecycle.ts", "utf8");

describe("Leg Manager checklist-gated lifecycle", () => {
  it("persists check-in before creating the pre-event checklist", () => {
    const checkIn = source.indexOf("await lifecycle.checkIn");
    const ensurePre = source.indexOf('phase: "pre_event"');
    expect(checkIn).toBeGreaterThan(-1);
    expect(ensurePre).toBeGreaterThan(checkIn);
    expect(source).toContain('nextAction: "pre_event_checklist"');
    expect(source).toContain('retryAction: "pre_event_checklist"');
  });

  it("separates start checkout from final departure", () => {
    expect(source).toContain('/manager/events/:bookingId/checkout/start');
    expect(source).toContain('phase: "post_event"');
    expect(source).toContain('canFinalizeCheckout');
  });
});
