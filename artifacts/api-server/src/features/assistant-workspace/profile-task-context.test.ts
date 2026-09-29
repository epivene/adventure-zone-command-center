import { it, expect } from "vitest";
import {
  buildProfileTaskContext,
  canCompleteProfileTask,
} from "./profile-task-context";
const task: any = {
  id: "task",
  scope: {
    objective: "Find named event organizer",
    eventYear: 2027,
    requestedFields: ["phone"],
  },
  counts: {
    total: 120,
    completed: 0,
    needsReview: 0,
    failed: 0,
    remaining: 120,
  },
};
it("bounds context to four members and scoped excerpts with explicit truncation", () => {
  const items: any[] = Array.from({ length: 120 }, (_, i) => ({
    id: String(i),
    profileId: String(i),
    state: "pending",
    reason: "x".repeat(20000),
    evidenceIds: [],
    receiptIds: [],
  }));
  const ev = Array.from({ length: 120 }, (_, i) => ({
    id: String(i),
    profileId: String(i),
    eventYear: 2027,
    retrievedAt: "2026-09-27",
    sourceUrl: "https://example.org",
    contactRole: "general_office" as const,
    excerpt: "x".repeat(10000),
  }));
  const context = buildProfileTaskContext(task, items, ev);
  expect(context.items).toHaveLength(4);
  expect(
    context.evidence.every((e) => e.excerpt.length <= 1200 && e.truncated),
  ).toBe(true);
  expect(context.evidence.some((e) => e.profileId === "8")).toBe(false);
  expect(JSON.stringify(context).length).toBeLessThanOrEqual(24000);
});
it("does not treat a general office, prior-year evidence, or a note receipt as completed contact work", () => {
  const ev: any = {
    profileId: "1",
    eventYear: 2026,
    contactRole: "general_office",
  };
  expect(canCompleteProfileTask(task, [ev], ["note"], { phone: "123" })).toBe(
    false,
  );
  expect(
    canCompleteProfileTask(
      { ...task, scope: { ...task.scope, objective: "Fill phone" } },
      [ev],
      ["note"],
      { phone: "123" },
    ),
  ).toBe(false);
});
it("does not infer completion of a coordinator objective from a filled generic phone", () => {
  expect(
    canCompleteProfileTask(
      {
        ...task,
        scope: {
          ...task.scope,
          objective: "Fill the festival coordinator's phone number",
        },
      },
      [
        {
          id: "e",
          profileId: "1",
          eventYear: 2027,
          contactRole: "general_office",
          retrievedAt: "now",
          sourceUrl: "https://example.org",
          excerpt: "Office 123",
        },
      ],
      ["update_profile"],
      { phone: "123" },
    ),
  ).toBe(false);
});
