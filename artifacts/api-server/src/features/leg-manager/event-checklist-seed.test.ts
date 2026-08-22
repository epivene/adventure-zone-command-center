import { describe, expect, it } from "vitest";
import {
  CHECKLIST_RESULT_GUIDANCE,
  POST_EVENT_RESOURCE_ITEMS,
  POST_EVENT_SITE_ITEMS,
  PRE_EVENT_RESOURCE_ITEMS,
  PRE_EVENT_SITE_ITEMS,
} from "./event-checklist-seed";

describe("event checklist templates", () => {
  it("preserves the source-derived pre-event safety details", () => {
    const labels = [...PRE_EVENT_RESOURCE_ITEMS, ...PRE_EVENT_SITE_ITEMS]
      .map((item) => item.label)
      .join("\n");
    expect(labels).toContain("larger than a quarter");
    expect(labels).toContain("knotted or otherwise secured");
    expect(labels).toContain("350+ lb");
    expect(labels).toContain("no more than 12 inches exposed");
    expect(labels).toContain("cone or tennis ball");
    expect(labels).toContain("safety signage");
    expect(labels).toContain("mats are lying flat and straight");
    expect(labels).toContain("straps and anchoring points");
  });

  it("keeps the paper result meanings in the app guidance", () => {
    expect(CHECKLIST_RESULT_GUIDANCE.acceptable).toContain("safe and acceptable");
    expect(CHECKLIST_RESULT_GUIDANCE.needs_work_safe).toContain("safe to operate");
    expect(CHECKLIST_RESULT_GUIDANCE.unsafe).toContain("cannot operate");
  });

  it("adds post-event condition and load-out checks as an operational extension", () => {
    const codes = [...POST_EVENT_RESOURCE_ITEMS, ...POST_EVENT_SITE_ITEMS].map((item) => item.code);
    for (const code of [
      "new_damage",
      "anchor_hardware_complete",
      "blower_condition",
      "cleaning_drying",
      "resource_ready_next_event",
      "site_cleanup",
      "missing_equipment",
    ]) {
      expect(codes).toContain(code);
    }
  });
});
