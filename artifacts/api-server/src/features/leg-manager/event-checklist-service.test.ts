import { describe, expect, it } from "vitest";
import {
  canCompleteChecklist,
  shouldGenerateForTags,
  validateChecklistAnswer,
} from "./event-checklist-service";

describe("event checklist rules", () => {
  it("shows untagged resource items for every assigned resource and tagged items only on intersection", () => {
    expect(shouldGenerateForTags([], ["carnival_game"])).toBe(true);
    expect(shouldGenerateForTags(["inflatable"], ["inflatable", "blower_powered"])).toBe(true);
    expect(shouldGenerateForTags(["multi_section"], ["inflatable"])).toBe(false);
  });

  it("requires notes for needs-work, unsafe, and safety-critical not-applicable answers", () => {
    expect(validateChecklistAnswer("needs_work_safe", null, false)).toContain("note");
    expect(validateChecklistAnswer("unsafe", "", true)).toContain("note");
    expect(validateChecklistAnswer("not_applicable", null, true)).toContain("explanation");
    expect(validateChecklistAnswer("acceptable", null, true)).toBeNull();
  });

  it("blocks completion until every answer is present and safety follow-up is synced", () => {
    expect(canCompleteChecklist([
      { result: "acceptable", followUpSyncState: "not_required" },
      { result: "needs_work_safe", followUpSyncState: "synced" },
    ])).toEqual({ allowed: true, reason: null });
    expect(canCompleteChecklist([
      { result: null, followUpSyncState: "not_required" },
    ]).allowed).toBe(false);
    expect(canCompleteChecklist([
      { result: "unsafe", followUpSyncState: "needs_attention" },
    ])).toEqual({ allowed: false, reason: "Safety follow-up still needs attention." });
  });
});
