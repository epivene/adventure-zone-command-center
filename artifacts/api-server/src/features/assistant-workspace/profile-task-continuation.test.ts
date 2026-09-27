import { it, expect } from "vitest";
import { resolveContinuation } from "./profile-task-context";
it("selects one resumable task, requests a choice for multiple, and preserves ordinary chat otherwise", () => {
  expect(resolveContinuation([])).toEqual({ kind: "none" });
  expect(resolveContinuation([{ id: "a", state: "paused" }] as any)).toEqual({
    kind: "resume",
    taskId: "a",
  });
  expect(
    resolveContinuation([
      { id: "a", state: "paused" },
      { id: "b", state: "waiting_review" },
    ] as any),
  ).toEqual({ kind: "choose", taskIds: ["a", "b"] });
  expect(
    resolveContinuation([
      { id: "a", state: "cancelled" },
      { id: "b", state: "proposed" },
    ] as any),
  ).toEqual({ kind: "none" });
});

it("excludes proposed write authority from plain Continue", () => {
  expect(
    resolveContinuation([
      { id: "proposal", state: "proposed" },
      { id: "done", state: "completed" },
    ] as any),
  ).toEqual({ kind: "none" });
});
