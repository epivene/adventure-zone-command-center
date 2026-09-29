import { it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ProfileTaskCard } from "./ProfileTaskCard";
export const task: any = {
  id: "task",
  state: "running",
  version: 1,
  scope: {
    objective: "Find event contacts",
    eventYear: 2027,
    requestedFields: ["phone"],
    taskCapUsd: 1,
  },
  authority: { actionKinds: ["add_profile_note"], allowedFields: [] },
  counts: {
    total: 120,
    completed: 80,
    needsReview: 10,
    failed: 5,
    remaining: 25,
  },
  items: [],
  changes: [],
};
it("shows exact disjoint progress and blocks duplicate controls while pending", () => {
  const command = vi.fn(() => new Promise<void>(() => {}));
  render(
    <ProfileTaskCard
      task={task}
      onCommand={command}
      onReview={async () => {}}
    />,
  );
  for (const label of [
    "80 completed",
    "10 need review",
    "5 failed",
    "25 remaining",
  ])
    expect(screen.getByText(label)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  expect(command).toHaveBeenCalledTimes(1);
});
it("shows last-known state offline and never queues controls", () => {
  render(
    <ProfileTaskCard
      task={{ ...task, state: "paused" }}
      offline
      onCommand={vi.fn()}
      onReview={async () => {}}
    />,
  );
  expect(screen.getByText(/Last-known progress/)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Resume" })).toBeDisabled();
});
it("labels finished unresolved work honestly", () => {
  render(
    <ProfileTaskCard
      task={{
        ...task,
        state: "completed",
        counts: { ...task.counts, remaining: 0 },
      }}
      onCommand={vi.fn()}
      onReview={async () => {}}
    />,
  );
  expect(
    screen.getByText("Finished with items needing review"),
  ).toBeInTheDocument();
});
it("lets the owner explicitly choose what completion means before starting", () => {
  const command = vi.fn().mockResolvedValue(undefined);
  render(
    <ProfileTaskCard
      task={{ ...task, state: "proposed" }}
      onCommand={command}
      onReview={async () => {}}
    />,
  );
  fireEvent.change(screen.getByLabelText("Task completion requirement"), {
    target: { value: "sourced_notes" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm scope and start" }),
  );
  expect(command).toHaveBeenCalledWith("resume", undefined, {
    completionMode: "sourced_notes",
  });
});
