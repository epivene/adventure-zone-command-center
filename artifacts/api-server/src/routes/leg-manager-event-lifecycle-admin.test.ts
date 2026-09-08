import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/routes/leg-manager-event-lifecycle-admin.ts", "utf8");

describe("owner event checklist oversight", () => {
  it("lists checklist runs and open resource condition issues", () => {
    expect(source).toContain('/manager-admin/events/checklists');
    expect(source).toContain('/manager-admin/resource-condition-issues');
    expect(source).toContain('router.get("/manager-admin/events/checklists/:runId"');
    expect(source).toContain('router.delete("/manager-admin/events/checklists/:runId"');
    expect(source).toContain('router.get("/manager-admin/reviews/due"');
    expect(source).toContain('router.delete("/manager-admin/reviews/due/:bookingId"');
    expect(source).toContain('router.get("/manager-admin/reviews"');
    expect(source).toContain('router.patch("/manager-admin/reviews/:reviewId"');
    expect(source).toContain('router.delete("/manager-admin/reviews/:reviewId"');
  });

  it("records attributed owner overrides without changing checklist results", () => {
    expect(source).toContain('allow_ready_to_operate');
    expect(source).toContain('allow_checkout');
    expect(source).toContain('eventChecklistOverrides');
    expect(source).toContain('actorId');
    expect(source).not.toContain('update(eventChecklistItemResults).set({ result');
  });

  it("lets the owner resolve a condition issue separately from the underlying inspection answer", () => {
    expect(source).toContain('/manager-admin/resource-condition-issues/:issueId/resolve');
    expect(source).toContain('resourceConditionIssues');
    expect(source).toContain('state: "resolved"');
  });
});
